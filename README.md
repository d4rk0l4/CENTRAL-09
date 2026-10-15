# ARQUIVO CENTRAL
Painel de jogos para o grupo (presencial + salas online via Firebase).

- `index.html` — o painel inteiro (arquivo único).
- `api/palavra.js` — função serverless que sorteia palavras com IA (Groq, com Gemini de reserva). As chaves ficam só no servidor.

## Publicar na Vercel
1. vercel.com → Add New → Project → importar este repositório (pode ser privado). Sem build: deixe "Framework Preset: Other".
2. Settings → Environment Variables: `GROQ_API_KEY` e (opcional) `GEMINI_API_KEY`.
3. Deploy. Depois adicione o domínio da Vercel em Firebase → Authentication → Settings → Authorized domains.
