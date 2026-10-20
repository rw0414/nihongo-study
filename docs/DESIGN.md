# 일본어 학습 앱 설계 문서

디자인 목업: https://claude.ai/artifact/KfgFexEYsAxvCW9J4JjfX9 (확정: 인디고·주황 톤, 카드형, 하단 탭)

## 1. 조사 결과 (2026-10-20)

| 항목 | 내용 |
|---|---|
| 개발 도구 | Node 24, npm 11, Python 3.14 (PyMuPDF, Pillow, EasyOCR 설치됨), Git. Java·Android SDK·Flutter 없음 |
| 문법 교재 PDF | 921MB, 668쪽, **스캔 이미지**(텍스트 레이어 없음), **내장 목차 없음**. 인쇄 쪽 번호 = PDF 쪽 번호. 차례는 PDF 11~14쪽 |
| 한자 교재 PDF | 836MB, 520쪽, 스캔본(일부 텍스트 레이어). 아직 미처리 |
| 음원 | PDF에 없음. 교재 7쪽에 QR코드·길벗 홈페이지(gilbut.co.kr) 다운로드 안내 → 사용자가 받은 mp3를 나중에 연결 |

## 2. 개발 방식 비교와 결정

| 방식 | 장점 | 단점 |
|---|---|---|
| **PWA (웹 앱, 홈 화면 설치)** ✅ | 설치할 도구가 거의 없음, PC·폰 모두 동작, 수정 즉시 반영, 서버 불필요 | 홈 화면 **위젯 불가**, iOS는 저장 공간 정책이 엄격 |
| 네이티브 Android (Kotlin) | 위젯·알림 완전 지원 | Android Studio·SDK 설치 필요, 초보자 유지보수 어려움 |
| 크로스플랫폼 (Flutter / React Native) | 위젯 일부 가능 | 툴체인 무거움, 위젯은 결국 네이티브 코드 필요 |

**결정: PWA로 시작하고, 위젯이 필요해지면(Phase 6) 같은 코드를 Capacitor로 감싸 Android 앱 + 네이티브 위젯을 추가한다.**
학습 로직·데이터는 그대로 재사용된다.

기술 스택: Vite + React + TypeScript, IndexedDB(Dexie) 로컬 저장, fflate(zip 풀기). 서버 없음, 유료 서비스 없음.

## 3. 기술적 제약과 해결 방법

- **PDF 처리**: 921MB 스캔 PDF는 스마트폰 브라우저 메모리로 열 수 없다.
  → PC에서 `tools/pdf2pkg.py`가 페이지를 1200px WebP 이미지로 변환(668쪽 → 약 50MB)하고 목차와 묶어 `.zip` 교재 패키지를 만든다. 앱은 패키지를 가져온다.
  같은 PDF는 항상 같은 ID(파일 SHA-256)를 가지므로 중복 등록이 차단된다. 변환은 페이지 단위로 저장되어 중단돼도 이어서 진행된다.
- **OCR·콘텐츠 추출(Phase 2)**: Claude Code가 PC에서 페이지 이미지를 직접 읽어 단어·문법·예문을 구조화한다. 앱에 API 키가 들어가지 않고 추가 비용이 없다. 불확실한 부분은 '검토 필요'로 표시하고 지어내지 않는다.
- **데이터 저장**: IndexedDB + `navigator.storage.persist()`(브라우저가 임의로 지우지 않도록 요청). 백업/복구 파일은 Phase 7.
- **음성**: 교재 mp3는 사용자가 합법적으로 받은 파일을 연결(Phase 6). 앱은 `<audio>`로 재생.
- **위젯**: 웹만으로는 불가 → Phase 6에서 Capacitor + Android 네이티브 위젯.
- **AI 채점(Phase 5)**: 기본은 로컬 채점(표기 정규화·문자 단위 비교·허용 답안). AI 채점은 선택 기능이며, 비용·키 보관 방식을 그때 먼저 설명한다.
- **폰에 설치하기**: PWA 설치에는 HTTPS 주소가 필요하다. 배포 방법(예: GitHub Pages, 앱 코드만 공개되고 교재는 폰 안에만 저장)은 별도로 결정한다.

## 4. 학습 흐름 (목업 기준, 확정)

오늘의 학습 = 1단계 단어 → 2단계 문법 카드 → 3단계 예문 작성.
1단계와 3단계는 각각 **새 항목 → 자동 전환("틀린 것 복습해 봐요") → 틀린/복습 예정 항목**으로 이어진다.
별도 복습 세션은 없고, 복습까지 끝내야 그날 학습 완료로 기록된다.

## 5. 데이터 모델

콘텐츠(단어·예문 자체)와 교재 내 출처, 학습 이력은 분리한다. 같은 단어가 여러 교재에 나와도 이력은 하나로 모이고 출처는 각각 남는다.

| 테이블 | 핵심 필드 | Phase |
|---|---|---|
| Book | id(PDF 해시), title, pageCount, printedPageOffset, sourceType, tocPages, lastPage | 1 ✅ |
| Chapter | id, bookId, parentId, level, order, title, startPage, endPage, status | 1 ✅ |
| SourcePage | [bookId+page], image(Blob), ocrText?, reviewNeeded? | 1 ✅ (ocr은 2) |
| LessonCard | id, chapterId, order, blocks[](원문/AI 구분 플래그), sourcePages[] | 2 |
| Vocabulary | id, surface, reading, meaning, pos, origin('book'\|'ai'\|'user') | 2 |
| VocabSource | vocabId, chapterId, page | 2 |
| Example | id, ja, ko, grammarIds[], answers[](허용 답안) | 2 |
| AudioAsset | id, bookId, chapterId?, file(Blob) 또는 url | 6 |
| StudySession | id, date(현지 날짜), startedAt, endedAt, steps 완료 여부 | 3 |
| ReviewHistory | itemType, itemId, at, correct, grade, responseMs, errorTypes[] | 3 |
| ReviewSchedule | itemType+itemId, step, ease, interval, dueAt, streak, lapses | 4 |
| ErrorRecord | itemType, itemId, errorType(조사·활용·어휘·표기), grammarId?, at | 4 |
| UserSettings | key → value (일일 목표, 테마, 글자 크기 등) | 3 |

복습 알고리즘(SM-2 기반)과 채점 로직은 `src/` 안에서 UI와 분리된 순수 함수로 만든다(현재 `src/book.ts`와 같은 방식).

## 6. MVP와 단계

- **Phase 1 (현재)**: 앱 골격, 라이브러리, 교재 패키지 가져오기, 목차 탐색, 원본 페이지 보기, 진도 저장, 다크 모드
- Phase 2: 한 단원씩 콘텐츠 변환(단어·문법·예문) + 검토·수정 화면
- Phase 3: 단어 카드 → 문법 카드 → 예문 입력/로컬 채점, 학습 기록
- Phase 4: 간격 반복 복습, 오답 노트
- Phase 5: 통계·달력, (선택) AI 채점
- Phase 6: 음원 연결, Android 위젯
- Phase 7: 백업/복구, 안정화

## 7. 새 교재 추가 방법 (Claude Code에게 요청)

1. PDF를 이 폴더에 둔다.
2. Claude Code가 차례 페이지를 읽어 `tools/books/<이름>.toc.json`을 만든다 (형식은 `grammar.toc.json` 참고).
3. `python tools/pdf2pkg.py <교재.pdf> tools/books/<이름>.toc.json` → `books/<id>.zip` 생성.
4. zip 파일을 폰으로 옮기고(OneDrive 등) 앱 라이브러리에서 '교재 추가'.
