import { useEffect, useState } from 'react'
import { db } from './db'

/** 저장된 원문 페이지 이미지를 <img src>로 쓸 수 있는 주소로 변환 */
export function usePageImage(bookId: string, page: number) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let u: string | undefined
    let alive = true
    db.pages.get([bookId, page]).then(p => {
      if (alive && p) setUrl((u = URL.createObjectURL(p.image)))
    })
    return () => { alive = false; if (u) URL.revokeObjectURL(u) }
  }, [bookId, page])
  return url
}
