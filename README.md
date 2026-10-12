# T-DX Lab☆問題演習システム v1.25.4 SIMPLE UI SAFE

通常運用をシンプルにした版です。

- 一般教員：試験作成 → 公開設定 → 回答分析 → 分析公開
- QR：通常は再印刷のみ。年間マスターCSVは不要
- 管理者：年度名簿 → アクセスキー発行 → QRカードPDF → 年度更新
- 手動JSON書き出しなど旧運用・非常時機能を通常画面から整理
- 生徒画面からJSON等の技術表示・試作用ログイン表示を削除
- 教員画面で未使用だった外部PDFライブラリの読み込みを削減

SAFE版のため、運用中の data/users.json・data/exams.json・data/analysis.json は含みません。
GASは v1.3 SECURITY RESET のままで変更不要です。
