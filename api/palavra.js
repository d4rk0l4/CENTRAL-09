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

const MODELOS_GROQ = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const MODELOS_GEMINI = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash'];

async function msgErro(r) {
  let t = '';
  try { const j = await r.json(); t = (j.error && (j.error.message || j.error)) || ''; } catch (e) { /* sem corpo */ }
  return r.status + (t ? ' ' + String(t).slice(0, 140) : '');
}

// tenta cada modelo da lista (o env var, se existir, vai primeiro); devolve o texto ou lança com os motivos
async function tentarModelos(modelos, chamar) {
  const erros = [];
  for (const m of modelos) {
    try { return await chamar(m); } catch (e) { erros.push(m + ': ' + e.message); }
  }
  throw new Error(erros.join(' | '));
}

async function viaGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('sem GROQ_API_KEY');
  const lista = [process.env.GROQ_MODEL, ...MODELOS_GROQ].filter(Boolean);
  return tentarModelos(lista, async (modelo) => {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'user', content: prompt }],
        temperature: 1.0, max_tokens: 300,
      }),
    });
    if (!r.ok) throw new Error(await msgErro(r));
    const j = await r.json();
    return j.choices[0].message.content;
  });
}

async function viaGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('sem GEMINI_API_KEY');
  const lista = [process.env.GEMINI_MODEL, ...MODELOS_GEMINI].filter(Boolean);
  return tentarModelos(lista, async (modelo) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 300 },
      }),
    });
    if (!r.ok) throw new Error(await msgErro(r));
    const j = await r.json();
    return j.candidates[0].content.parts.map(p => p.text || '').join('');
  });
}

function extrairPalavra(texto) {
  texto = String(texto || '');
  let p;
  const m = texto.match(/\{[\s\S]*?\}/);
  if (m) { try { p = JSON.parse(m[0]).palavra; } catch (e) { /* cai no texto puro */ } }
  if (!p) p = texto.split('\n')[0];
  p = String(p || '').replace(/["“”.*]/g, '').trim();
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
