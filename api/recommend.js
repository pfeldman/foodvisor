import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const RECIPE_SYSTEM = `Sos un chef nutricionista argentino que recomienda recetas saludables y accesibles.
- Usás español rioplatense argentino
- Tus recetas usan ingredientes fáciles de conseguir en Argentina
- Cada receta incluye: nombre, ingredientes con gramos, pasos breves, y valores nutricionales totales
- Adaptás las recetas al perfil y objetivos del usuario
- Si el usuario necesita más proteína, priorizás recetas proteicas; si necesita fibra, recetas con legumbres/verduras, etc.
- Las recetas son prácticas, para el día a día, no platos gourmet inalcanzables
- Respondé en JSON válido

Formato de respuesta:
{
  "recetas": [
    {
      "nombre": "nombre de la receta",
      "descripcion": "descripción breve",
      "tiempo": "20 min",
      "ingredientes": [
        { "nombre": "ingrediente", "gramos": 200, "detalle": "detalle opcional" }
      ],
      "pasos": ["paso 1", "paso 2", "paso 3"],
      "totales": { "calorias": 400, "proteinas": 30, "carbohidratos": 40, "grasas": 12, "fibra": 6 },
      "tags": ["alta en proteína", "rápida"]
    }
  ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const { profile, history, context } = req.body;

    const messages = [{ role: 'system', content: RECIPE_SYSTEM }];

    const contextParts = [];
    if (profile) contextParts.push(`PERFIL DEL USUARIO: ${JSON.stringify(profile)}`);
    if (history && history.length > 0) contextParts.push(`HISTORIAL RECIENTE: ${JSON.stringify(history.slice(-30))}`);
    if (contextParts.length > 0) {
      messages.push({ role: 'system', content: contextParts.join('\n\n') });
    }

    const userMsg = context || 'Recomendame 3 recetas saludables para esta semana basándote en mi perfil y lo que vengo comiendo.';
    messages.push({ role: 'user', content: userMsg });

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 1500,
    });

    const content = response.choices[0].message.content.trim();
    const match = content.match(/\{.*\}/s);
    const result = match ? JSON.parse(match[0]) : JSON.parse(content);
    result.recetas = result.recetas || [];

    return res.status(200).json(result);
  } catch (err) {
    console.error('Recommend error:', err);
    return res.status(500).json({ detail: err.message || 'Error' });
  }
}
