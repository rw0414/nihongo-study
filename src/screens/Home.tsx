import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { chapterAt, printedPage, progress } from '../book'
import { go } from '../App'

const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })

// 오늘의 학습 3단계. Phase 3에서 실제 분량·진행 상태와 연결한다.
const STEPS = ['단어 암기', '문법 카드', '예문 작성']

export default function Home() {
  const recent = useLiveQuery(() => db.books.orderBy('lastOpenedAt').reverse().first())
  const anyBook = useLiveQuery(() => db.books.count())
  const chapters = useLiveQuery(() => (recent ? db.chapters.where('bookId').equals(recent.id).toArray() : []), [recent?.id])
  const current = recent && chapters && chapterAt(chapters, recent.lastPage)
  const pct = Math.round(progress(chapters ?? []) * 100)

  return (
    <>
      <div>
        <div className="sub">{today}</div>
        <h1>오늘의 학습</h1>
      </div>

      {recent ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row" style={{ gap: 16 }}>
            <div className="ring" style={{ background: `conic-gradient(var(--accent) 0 ${pct}%, var(--line) ${pct}% 100%)` }}>
              <span>{pct}%</span>
            </div>
            <div className="grow">
              <div className="sub">{recent.title}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{current?.title ?? '처음부터'}</div>
              <div className="sub">p.{printedPage(recent.lastPage, recent.printedPageOffset)}까지 봄 · 교재 진도 {pct}%</div>
            </div>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s}>
                <div className="num">{i + 1}</div>
                <div className="grow" style={{ fontWeight: 500 }}>{s}</div>
                <span className="muted small">준비 중</span>
              </div>
            ))}
          </div>
          <button className="btn primary wide" onClick={() => go(`/read/${recent.id}/${recent.lastPage}`)}>
            원본 이어서 보기
          </button>
          <div className="muted small">단어·문법·예문 학습은 교재 콘텐츠 변환(Phase 2) 후 열립니다.</div>
        </div>
      ) : (
        <div className="card">
          <p style={{ marginTop: 0 }}>{anyBook ? '교재를 열면 여기에 표시됩니다.' : '아직 등록된 교재가 없습니다.'}</p>
          <button className="btn primary" onClick={() => go('/library')}>라이브러리로 가기</button>
        </div>
      )}
    </>
  )
}
