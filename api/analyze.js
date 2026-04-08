import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT = `Sos un nutricionista experto en alimentación e hidratación, especializado en la dieta argentina y latinoamericana.
Analizá esta imagen e identificá cualquier comida O bebida que aparezca. Respondé ÚNICAMENTE con un JSON válido:

{
  "plato": "nombre en español rioplatense argentino",
  "calorias": 450,
  "descripcion": "descripción breve en español rioplatense (1-2 oraciones)",
  "confianza": "alta"
}

Reglas estrictas:
- Registrá tanto comidas como bebidas: mate, café, té, jugos, gaseosas, agua, cerveza, vino, licuados, etc.
- Ejemplos de bebidas: "mate", "café con leche", "jugo de naranja", "Coca-Cola", "agua con gas", "cerveza", "vino tinto", "licuado de banana".
- Ejemplos de comidas: "milanesa a la napolitana", "asado de tira", "empanadas de carne", "medialunas", "revuelto gramajo", "tarta de acelga", "locro", "choripán", "sorrentinos".
- Usá siempre el nombre más simple y reconocible en rioplatense (ej: "mate", no "infusión de yerba mate").
- Las calorías son aproximadas para una porción/vaso/taza habitual.
- Para el mate sin azúcar, las calorías son prácticamente 0 (~5 kcal). Con azúcar ~20 kcal. Con leche ~80 kcal.
- El campo "confianza" debe ser: "alta" si estás seguro, "media" si tenés dudas, "baja" si no podés identificarlo bien.
- Solo poné plato "No se detectó" y calorias 0 si la imagen no muestra absolutamente ninguna comida ni bebida.
- Respondé SOLO con el JSON, sin texto adicional, sin markdown.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ detail: 'Method not allowed' });
  }

  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ detail: 'No image provided' });
    }

    // Strip data URL prefix if present
    const imageData = image.includes(',') ? image.split(',')[1] : image;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageData}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
      max_tokens: 350,
    });

    const content = response.choices[0].message.content.trim();

    // Extract JSON even if wrapped in markdown code blocks
    const match = content.match(/\{.*\}/s);
    const result = match ? JSON.parse(match[0]) : JSON.parse(content);

    result.plato = result.plato || 'Plato desconocido';
    result.calorias = parseInt(result.calorias) || 0;
    result.descripcion = result.descripcion || '';
    result.confianza = result.confianza || 'baja';

    return res.status(200).json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    return res.status(500).json({ detail: err.message || 'Error analyzing image' });
  }
}
