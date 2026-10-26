# 수익화 계약 검토

광고 수익화 계약서(Word·PDF)를 올리면 AI가 조항을 분석하고, 버전 사이의 수정 내역과 코멘트를 정리하고, 사내 툴에 붙여 넣을 텍스트와 노션 페이지를 만들어 주는 팀 공용 웹 툴이에요.

claude.ai **아티팩트** 한 페이지로 동작해요. 저장소, AI 호출, 노션 연동, 사용자 정보는 모두 claude.ai 아티팩트 런타임(`window.claude.use(...)`)을 써요. 그래서 별도 서버나 API 키가 필요 없어요.

## 기능

| 메뉴 | 내용 |
| --- | --- |
| 현재 계약서 조항 분석 | 팀 검토 기준표에 맞춰 조항을 유리 · 주의 · 불리 · 정보로 판정해요. 조항 번호를 누르면 원문·번역 전문의 해당 위치로 이동해요 |
| 계약서 수정 히스토리 | 버전 사이에 바뀐 문단을 수정 전후로 비교하고 한글 번역을 붙여요 |
| 문서 내 코멘트 히스토리 | Word 코멘트와 PDF 주석을 조항별 쟁점으로 묶어 맥락, 본문 변화, 결과 판정을 보여줘요 |
| 복붙 텍스트 | 법무 검토 요청, 업체 회신 공유 댓글, 계약 품의서 문안을 만들어요 |
| 노션 DB 생성 | 노션의 계약서 DB와 파트너 DB에 업체 페이지를 만들고 두 페이지를 relation으로 연결해요. 파트너 DB 속성(여신일, R/S, 정산기준 등)은 계약서 내용으로 채워요 |

- Word 변경 추적(`w:ins`/`w:del`), 코멘트, 자동 번호(`numbering.xml`)를 직접 파싱해요.
- PDF는 pdf.js로 텍스트와 주석을 읽어요.
- 계약 건, 버전, 분석 결과는 아티팩트 공유 DB에 저장돼서 팀원이 같은 히스토리를 봐요.

## 구조

```
app/
  shell.html          마크업과 스타일
  parse-core.js       docx·pdf 파싱, 문단 비교 (Node 테스트에서도 그대로 씀)
  app.js              화면, AI 파이프라인, 노션 연동
  config.example.js   설정 예시
  build.sh            위 파일을 합쳐 app/contract-review.html 한 장을 만들어요
tests/
  smoke.js            jsdom에서 db·AI·노션을 흉내 내 전체 흐름을 돌려 봐요
  test-docx.js        docx 폴더를 순서대로 파싱하고 버전 비교 결과를 출력해요
  test-pdf.js         PDF 파싱 결과를 출력해요
  make-pdf.js         docx로 주석이 달린 테스트 PDF를 만들어요
```

## 설정

```sh
cp app/config.example.js app/config.local.js
```

`config.local.js`에 다음 값을 넣어요. 이 파일은 `.gitignore`에 들어 있어서 저장소에 올라가지 않아요.

- `COMPANY`: 우리 회사 이름과, 문서 작성자 이름으로 우리 쪽을 알아보는 패턴
- `NOTION_DS`, `PARTNER_DS`: 노션 계약서 DB와 파트너 DB의 data source ID
- `PARTNER_FIELDS`: 파트너 DB에서 계약서로 채울 속성. 이름과 선택지는 노션 DB와 글자까지 똑같아야 해요
- `PARTNER_RELATION`, `CONTRACT_RELATION`, `CONTRACT_TITLE`: relation 속성 이름과 계약서 DB의 제목 속성 이름
- `DEFAULT_CRITERIA`: 검토 기준표 기본값. 실제 기준은 앱의 기준표 편집에서 저장하면 공유 DB에 들어가요

## 빌드와 배포

```sh
sh app/build.sh        # config.local.js가 없으면 config.example.js로 빌드해요
```

`app/contract-review.html`을 claude.ai 아티팩트로 공개하고 다음 capability를 선언해요.

```json
{
  "db": {},
  "user": { "scopes": ["profile"] },
  "sample": {},
  "mcp": { "servers": [{ "server": "Notion", "tools": ["notion-create-pages", "notion-search", "notion-update-page"] }] }
}
```

팀원은 아티팩트의 Share 메뉴에서 **Contributor 이상**으로 추가해요. 각자 처음 쓸 때 Claude 사용과 Notion 접근을 한 번씩 허용해야 해요. AI 사용량은 분석을 실행한 사람의 계정에서 차감돼요.

## 테스트

```sh
cd tests && npm install
sh ../app/build.sh
OUR_AUTHORS="작성자1,작성자2" node smoke.js ../app/contract-review.html <docx 폴더>    # 파일 이름 순서가 버전 순서
node test-docx.js <docx 폴더>
node make-pdf.js <docx 파일> out.pdf && node test-pdf.js out.pdf
```

계약서 원본은 기밀이에요. 테스트용 계약서는 저장소 밖에 두세요. `.gitignore`가 `*.docx`와 `*.pdf`를 막아 두었어요.

## 보안 메모

- 계약서 본문, 코멘트, 분석 결과는 아티팩트를 만든 claude.ai 조직의 저장소에 저장돼요. 팀에서 쓰기 전에 사내 보안·법무 기준을 확인하세요.
- 노션 연동은 페이지를 연 사람의 노션 커넥터 권한으로 동작해요. 토큰은 페이지에 노출되지 않아요.
- 노션 업로드 제한 때문에 계약서 파일은 노션 페이지에 직접 첨부해야 해요.
