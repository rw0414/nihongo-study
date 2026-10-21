// 백업/복구. 원문 페이지 이미지(교재 패키지 .zip, 약 50MB)는 빼고 나머지 전부를 JSON 파일 하나로 저장한다.
// 복구 후 원본 페이지를 보려면 라이브러리에서 같은 교재 패키지를 다시 추가하면 된다 (이미지만 채워짐).
import { db } from './db'

const TABLES = ['books', 'chapters', 'units', 'vocab', 'sentences', 'reviews', 'sessions'] as const
const FORMAT = 'nihongo-study-backup'

export interface BackupInfo { at: string; counts: Record<string, number> }

export async function makeBackup(): Promise<{ blob: Blob; name: string }> {
  const tables: Record<string, unknown[]> = {}
  await db.transaction('r', TABLES.map(t => db.table(t)), async () => {
    for (const t of TABLES) tables[t] = await db.table(t).toArray()
  })
  const at = new Date().toISOString()
  const blob = new Blob([JSON.stringify({ format: FORMAT, version: 1, at, tables })], { type: 'application/json' })
  return { blob, name: `일본어공부-백업-${at.slice(0, 10)}.json` }
}

/** 파일 내용을 먼저 확인만 한다 (복구 전 사용자에게 보여 주기) */
export async function readBackup(file: File): Promise<{ info: BackupInfo; tables: Record<string, unknown[]> }> {
  let data: { format?: string; version?: number; at?: string; tables?: Record<string, unknown[]> }
  try { data = JSON.parse(await file.text()) } catch { throw new Error('백업 파일을 읽을 수 없습니다 (JSON 형식이 아님)') }
  if (data.format !== FORMAT || data.version !== 1 || !data.tables) throw new Error('이 앱의 백업 파일이 아닙니다')
  for (const t of TABLES) if (!Array.isArray(data.tables[t])) throw new Error(`백업 파일에 ${t} 데이터가 없습니다`)
  return { info: { at: data.at ?? '', counts: Object.fromEntries(TABLES.map(t => [t, data.tables![t].length])) }, tables: data.tables }
}

/** 현재 데이터(원문 이미지 제외)를 백업 내용으로 바꾼다. 한 트랜잭션이라 실패하면 아무것도 바뀌지 않는다 */
export async function restoreBackup(tables: Record<string, unknown[]>) {
  await db.transaction('rw', TABLES.map(t => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      await db.table(t).bulkAdd(tables[t])
    }
  })
}
