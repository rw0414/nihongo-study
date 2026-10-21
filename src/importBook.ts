// 교재 패키지(.zip) 가져오기. tools/pdf2pkg.py 가 만든 파일을 읽어 IndexedDB에 저장한다.
import { unzip } from 'fflate'
import { db, type Chapter, type SourcePage } from './db'
import { parseManifest } from './book'
import { parseUnit } from './content'

const unzipAsync = (data: Uint8Array) =>
  new Promise<Record<string, Uint8Array>>((ok, ng) => unzip(data, (e, r) => (e ? ng(e) : ok(r))))

export async function importBookPackage(file: File): Promise<string> {
  const files = await unzipAsync(new Uint8Array(await file.arrayBuffer()))
  const raw = files['manifest.json']
  if (!raw) throw new Error('교재 패키지 오류: manifest.json이 없습니다 (pdf2pkg.py로 만든 .zip인지 확인)')
  const m = parseManifest(JSON.parse(new TextDecoder().decode(raw)))

  if (await db.books.get(m.id)) throw new Error(`이미 등록된 교재입니다: ${m.title}`)

  const pages: SourcePage[] = []
  for (let p = 1; p <= m.pageCount; p++) {
    const img = files[`pages/${String(p).padStart(4, '0')}.webp`]
    if (!img) throw new Error(`교재 패키지 오류: ${p}쪽 이미지가 없습니다`)
    pages.push({ bookId: m.id, page: p, image: new Blob([img as Uint8Array<ArrayBuffer>], { type: 'image/webp' }) })
  }
  const chapters: Chapter[] = m.chapters.map((c, order) => ({
    ...c,
    id: `${m.id}/${c.id}`,
    parentId: c.parentId && `${m.id}/${c.parentId}`,
    bookId: m.id,
    order,
    status: 'new',
  }))

  // 한 트랜잭션: 중간에 실패하면 아무것도 저장되지 않는다 (반쪽짜리 교재 방지)
  await db.transaction('rw', db.books, db.chapters, db.pages, async () => {
    await db.books.add({
      id: m.id, title: m.title, pageCount: m.pageCount, printedPageOffset: m.printedPageOffset,
      sourceFile: m.sourceFile, sourceType: m.sourceType, tocPages: m.tocPages,
      addedAt: Date.now(), lastPage: 1,
    })
    await db.chapters.bulkAdd(chapters)
    await db.pages.bulkAdd(pages)
  })
  // 브라우저가 저장 공간 부족 시 데이터를 임의로 지우지 않도록 요청
  await navigator.storage?.persist?.()
  return m.id
}

/** 단원 콘텐츠(.json) 가져오기. 여러 파일을 한 번에 받을 수 있다. 가져온 단원 수를 돌려준다. */
export async function importUnitFiles(files: File[]): Promise<number> {
  // 전부 먼저 검증하고 나서 저장 (하나라도 틀리면 아무것도 저장하지 않음)
  const units = await Promise.all(files.map(async f => parseUnit(JSON.parse(await f.text()))))
  for (const u of units) {
    const ch = await db.chapters.get(`${u.bookId}/${u.chapterId}`)
    if (!ch) throw new Error(`콘텐츠 파일 오류: 등록된 교재에 단원 ${u.chapterId}가 없습니다 (교재를 먼저 추가하세요)`)
  }

  await db.transaction('rw', db.units, db.vocab, db.sentences, async () => {
    for (const u of units) {
      const unitId = `${u.bookId}/${u.chapterId}`
      const prev = await db.units.get(unitId)
      // 선생님 검토를 마친 콘텐츠는 검토 완료로
      await db.units.put({ id: unitId, bookId: u.bookId, data: u, status: u.review ? 'checked' : prev?.status ?? 'review', importedAt: Date.now() })

      // 사용자가 고친 단어·예문은 유지하고 나머지는 새 내용으로 교체
      const keepV = new Set((await db.vocab.where('unitId').equals(unitId).filter(v => !!v.edited).primaryKeys()))
      const keepS = new Set((await db.sentences.where('unitId').equals(unitId).filter(s => !!s.edited).primaryKeys()))
      await db.vocab.where('unitId').equals(unitId).filter(v => !v.edited).delete()
      await db.sentences.where('unitId').equals(unitId).filter(s => !s.edited).delete()
      await db.vocab.bulkPut(u.vocab
        // AI 선생님이 검토한 단원의 AI 제안 단어는 승인된 상태로 (사용자는 언제든 삭제 가능)
        .map(v => ({ ...v, id: `${unitId}/${v.id}`, unitId, bookId: u.bookId, approved: v.origin === 'ai' && u.review ? true : undefined }))
        .filter(v => !keepV.has(v.id)))
      await db.sentences.bulkPut(u.sentences
        .map(s => ({ ...s, id: `${unitId}/${s.id}`, unitId, bookId: u.bookId }))
        .filter(s => !keepS.has(s.id)))
    }
  })
  return units.length
}
