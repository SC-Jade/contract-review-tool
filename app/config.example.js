/* ===== 수익화 계약 검토 · 설정 예시 =====
   config.local.js로 복사해 사내 값으로 바꿔 쓰세요. config.local.js는 저장소에 올리지 않아요(.gitignore).
   노션 data source ID는 노션 커넥터의 fetch 결과(collection://…)에서 확인할 수 있어요. */
/* 우리 회사. 프롬프트와 화면 문구, 작성자 자동 판별(match: 문서 작성자 이름에 이 패턴이 있으면 우리 쪽)에 써요 */
const COMPANY = { ko:"우리 회사", en:"Example Corp.", match:/example corp|우리 회사/i };
const NOTION_DS = "00000000-0000-0000-0000-000000000001";      /* 계약서 DB */
const PARTNER_DS = "00000000-0000-0000-0000-000000000002";     /* 파트너 DB */
/* t: title|multi|select|pct|text, opts는 노션 DB의 선택지와 똑같이 */
const PARTNER_FIELDS = [
  {k:"파트너명", t:"title"},
  {k:"거래 여부", t:"select", opts:["연동중","거래중","거래종료"], def:"연동중"},
  {k:"정산기준", t:"select", opts:["우리 회사","업체"], hint:"어느 쪽 집계 수치로 정산하는지"},
  {k:"여신일", t:"select", opts:["NET 30","NET 45","NET 60"], hint:"지급 기한"},
  {k:"R/S 조건", t:"pct", hint:"우리 회사 몫"},
  {k:"송금 최소 기준", t:"text"},
  {k:"오차조정기준", t:"text"}
];
const PARTNER_RELATION = "계약서";      /* 파트너 DB → 계약서 DB relation 속성 */
const CONTRACT_RELATION = "파트너";     /* 계약서 DB → 파트너 DB relation 속성 */
const CONTRACT_TITLE = "업체명";

/* 팀 내부 계약 검토 기준표의 기본값. 실제 기준은 앱의 ‘기준표 편집’에서 저장하면 공유 DB에 들어가요. */
const DEFAULT_CRITERIA = [
  {id:"pay-term", g:"정산", k:"여신일(Payment term)", std:"예: Net 30 days", how:"협의 가능 범위를 적어 주세요"},
  {id:"pay-data", g:"정산", k:"정산 데이터 집계 기준", std:"예: 우리 집계 수치 기준으로 정산", how:""},
  {id:"pay-disc", g:"정산", k:"오차 발생 시 처리", std:"예: 업체 귀책 오차는 업체 부담", how:""},
  {id:"deduction", g:"정산", k:"Deduction", std:"예: 정산 확정 후 차감 조항 없음", how:""},
  {id:"min-payout", g:"정산", k:"정산 최소 금액", std:"예: $100 미만은 다음 달 합산", how:""},
  {id:"logo", g:"책임", k:"회사명·로고 마케팅 활용", std:"예: 사전 서면 동의", how:""}
];
