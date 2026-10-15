// Função serverless (Vercel): sorteia uma palavra com IA sem expor a chave no navegador.
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   GROQ_API_KEY    (principal)    GROQ_MODEL    (opcional, padrão llama-3.3-70b-versatile)
//   GEMINI_API_KEY  (reserva)      GEMINI_MODEL  (opcional, padrão gemini-2.0-flash)
//   ALLOWED_ORIGIN  (opcional, ex.: https://seu-site.vercel.app — bloqueia uso por outros sites)

const DIFICULDADES = { facil: 'muito comum e conhecida por todos', media: 'conhecida, mas não óbvia', dificil: 'menos comum, porém ainda reconhecível por adultos brasileiros' };

function montarPrompt(categoria, dificuldade, evitar) {
  return `Você sorteia palavras para jogos de festa em português do Brasil.
Categoria: "${categoria}". Dificuldade: ${DIFICULDADES[dificuldade]}.
Regras: devolva UMA única palavra ou expressão curta (até 3 palavras), sem explicação, sem aspas, sem pontuação final.
${evitar.length ? 'NÃO use nenhuma destas: ' + evitar.join(', ') + '.' : ''}
Responda apenas em JSON no formato {"palavra":"..."}.`;
}

async function viaGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('sem GROQ_API_KEY');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.1, max_tokens: 40,
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) throw new Error('groq ' + r.status);
  const j = await r.json();
  return j.choices[0].message.content;
}

async function viaGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('sem GEMINI_API_KEY');
  const modelo = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.1, maxOutputTokens: 40, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const j = await r.json();
  return j.candidates[0].content.parts[0].text;
}

function extrairPalavra(texto) {
  let p;
  try { p = JSON.parse(texto).palavra; } catch { p = texto; }
  p = String(p || '').replace(/["“”.]/g, '').trim();
  return p && p.length <= 40 ? p : null;
}

module.exports = async function handler(req, res) {
  const origem = process.env.ALLOWED_ORIGIN;
  if (origem) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });
  if (origem && req.headers.origin && req.headers.origin !== origem) return res.status(403).json({ erro: 'origem não permitida' });

  const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const categoria = String(corpo.categoria || '').trim().slice(0, 40);
  const dificuldade = DIFICULDADES[corpo.dificuldade] ? corpo.dificuldade : 'media';
  const evitar = (Array.isArray(corpo.evitar) ? corpo.evitar : []).slice(0, 30).map(s => String(s).slice(0, 40));
  if (!categoria) return res.status(400).json({ erro: 'categoria obrigatória' });

  const prompt = montarPrompt(categoria, dificuldade, evitar);
  const detalhes = [];
  for (const provedor of [viaGroq, viaGemini]) {
    try {
      const palavra = extrairPalavra(await provedor(prompt));
      if (palavra) return res.status(200).json({ palavra, via: provedor.name });
      detalhes.push(provedor.name + ': resposta vazia');
    } catch (e) { detalhes.push(provedor.name + ': ' + e.message); } // só códigos de status, nunca a chave
  }
  return res.status(502).json({ erro: 'nenhuma IA respondeu', detalhes });
};
