# 영어 단어장 (english-wordbook)

Obsidian `영어공부` 노트를 그대로 플래시카드로 바꿔주는 개인용 PWA 단어장.
빌드 도구 없이 순수 HTML/CSS/JS 로 만들어져 GitHub Pages 에 그대로 올라간다.

**앱 주소:** https://ijk11.github.io/english-wordbook/

폰에서 위 주소를 열고 *홈 화면에 추가* 하면 앱처럼 설치되고, 설치 후에는 비행기 모드에서도 동작한다.

---

## 무엇이 들어있나

마크다운 노트 5개에서 뽑아낸 **648장**의 카드를 5개 덱으로 나눠 담았다.

| 덱 | 장수 | 원본 노트 |
| --- | ---: | --- |
| TOEIC 단어 | 360 | `Toeic 영어단어.md` |
| 일상 회화 | 122 | `회화표현.md` |
| OPIc 표현 | 81 | `OPIC 영어.md` |
| TOEIC Speaking | 57 | `Toeic speaking.md` |
| 실무 영어 | 28 | `전문 실무 영어.md` |

카드마다 표제어 · 뜻 · 예문 · 보충설명 · 공부한 날짜가 들어가고,
`단어 / 표현 / 문장` 으로 자동 분류되어 필터링에 쓰인다.

## 기능

- **플래시카드** — 탭해서 뒤집고 `다시 / 어려움 / 알맞음 / 쉬움` 으로 채점.
  SM-2 를 줄인 간격 반복 알고리즘이 다음 복습 날짜를 잡아준다.
- **방향 전환** — 영어→한글, 한글→영어, 섞기. Speaking 덱처럼 한→영이 중요한 덱에 쓸모 있다.
- **퀴즈** — 4지선다. 오답 보기는 같은 덱·같은 종류에서 골라 헷갈리게 낸다. 결과에서 틀린 카드를 바로 복습.
- **찾기** — 영어·한글·예문까지 통합 검색. 덱 / 종류 / 즐겨찾기 / 안 본 카드 / 어려운 카드 / 복습 예정 필터.
- **발음** — 브라우저 TTS(`speechSynthesis`) 로 표제어와 예문을 읽어준다.
- **기록** — 암기율 링, 연속 학습일, 최근 12주 히트맵.
- **오프라인** — 서비스워커가 앱과 데이터를 캐시한다.

진도·통계·즐겨찾기는 전부 브라우저 `localStorage` 에만 저장된다. 서버도 계정도 없다.
기기를 옮길 때는 *설정 → 진도 내보내기 / 가져오기* 로 JSON 을 주고받으면 된다.

## 노트를 고쳤을 때 (데이터 갱신)

Obsidian 에서 노트를 고친 뒤 이 저장소에서:

```bash
python tools/build_data.py --src "D:/iCloud Drive/iCloudDrive/iCloud~md~obsidian/iobsidian/영어공부"
```

`data/cards.json` 이 다시 만들어진다. 커밋해서 push 하면 Pages 에 반영된다.
저장소 안의 `source/` 사본까지 같이 갱신하려면 md 파일을 복사해 넣고 인자 없이 실행하면 된다.

```bash
python tools/build_data.py          # source/ 를 소스로 사용
```

파서가 다루는 노트 형식:

- `- **단어** 뜻` (Obsidian 하이라이트 `<span>` 태그는 자동으로 벗겨낸다)
- `- 한국어 뜻: english term` (Speaking 노트 형식, 좌우를 알아서 뒤집는다)
- `- 한글 그룹 제목` + 들여쓴 하위 항목 → 하위 항목이 각각 카드가 되고 제목이 분류로 붙는다
- 들여쓴 줄은 영어면 **예문**, 한글이 섞이면 **보충설명**
- `#### 2025-04-27` 형식의 날짜 헤딩 → 카드의 학습 날짜
- 마크다운 표 (2열·3열) → 실무 영어 노트용

## 로컬에서 돌려보기

```bash
python -m http.server 8777
```

http://localhost:8777 을 연다. (`file://` 로 열면 `fetch` 와 서비스워커가 막힌다.)

## 구조

```
index.html                 화면 5개(홈·학습·찾기·퀴즈·설정)의 마크업
styles.css                 라이트/다크 자동 전환 토큰 + 레이아웃
app.js                     SRS 스케줄러, 학습 큐, 검색, 퀴즈, 저장
sw.js                      오프라인 캐시 (앱=캐시 우선, 데이터=네트워크 우선)
manifest.webmanifest       PWA 설치 정보
data/cards.json            생성된 카드 데이터 (직접 고치지 말 것)
source/*.md                Obsidian 노트 사본 (재생성용)
tools/build_data.py        md → cards.json 변환기
tools/make_icons.py        아이콘 생성기
```

## 아이콘 다시 만들기

```bash
python tools/make_icons.py
```
