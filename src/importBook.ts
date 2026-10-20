// 교재 패키지(.zip) 가져오기. tools/pdf2pkg.py 가 만든 파일을 읽어 IndexedDB에 저장한다.
import { unzip } from 'fflate'
import { db, type Chapter, type SourcePage } from './db'
import { parseManifest } from './book'

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
