import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NURI_SYSTEM = `Sos "Nuri", el coach nutricional de Foodvisor. Tu personalidad:
- Sos empático/a, cercano/a, pero directo/a cuando hay que serlo
- Usás español rioplatense argentino (vos, ché, dale, ponele, bancá)
- Tenés los conocimientos de un médico nutricionista con enfoque en alimentación real
- Evitás tecnicismos innecesarios pero podés profundizar si te lo piden
- No diagnosticás enfermedades — siempre recomendás consultar con un profesional cuando corresponde
- Celebrás los logros del usuario, por más chiquitos que sean
- Cuando das recomendaciones de comida, usás ejemplos accesibles de la dieta argentina/latinoamericana
- Sos práctico/a: si alguien come mal un día, no lo retás, lo motivás para el siguiente
- Podés analizar patrones semanales: exceso de ultra-procesados, falta de proteína, poca fibra, etc.
- Conocés de nutrición deportiva, alimentación para bajar/subir de peso, mantenimiento, y salud general
- Tus respuestas son concisas y útiles — no divagás

Tenés acceso al perfil del usuario (objetivos, datos físicos) y su historial alimentario reciente.
Usá esta información para personalizar cada respuesta. Si el usuario pregunta algo general sin contexto, respondé con lo que sabés de su perfil.

IMPORTANTE — Interpretación de objetivos del perfil:
- "bajar" = bajar de peso (déficit calórico)
- "mantener" = mantener el peso actual
- "masa_muscular" o "subir" = ganar masa muscular (NO es subir de peso — es ganar músculo con superávit calórico controlado y alta proteína)
- "salud" = comer más saludable en general
- "energia" = tener más energía durante el día

Nunca digas "subir de peso" si el objetivo es "masa_muscular" — decí "ganar masa muscular" o "ganar músculo".`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const { message, profile, history } = req.body;
    if (!message) {
      return res.status(400).json({ detail: 'No message provided' });
    }

    const messages = [{ role: 'system', content: NURI_SYSTEM }];

    const contextParts = [];
    if (profile) contextParts.push(`PERFIL DEL USUARIO: ${JSON.stringify(profile)}`);
    if (history && history.length > 0) contextParts.push(`HISTORIAL ALIMENTARIO RECIENTE: ${JSON.stringify(history.slice(-50))}`);
    if (contextParts.length > 0) {
      messages.push({ role: 'system', content: contextParts.join('\n\n') });
    }

    messages.push({ role: 'user', content: message });

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 800,
    });

    return res.status(200).json({ response: response.choices[0].message.content.trim() });
  } catch (err) {
    console.error('Coach error:', err);
    return res.status(500).json({ detail: err.message || 'Error' });
  }
}
