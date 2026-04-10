import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT = `Sos un nutricionista experto en alimentación e hidratación, especializado en la dieta argentina y latinoamericana.
Analizá esta imagen e identificá cualquier comida O bebida que aparezca. Respondé ÚNICAMENTE con un JSON válido:

{
  "plato": "nombre en español rioplatense argentino",
  "descripcion": "descripción breve en español rioplatense (1-2 oraciones)",
  "confianza": "alta",
  "ingredientes": [
    { "nombre": "ingrediente 1", "gramos": 150, "calorias": 200, "proteinas": 12, "carbohidratos": 20, "grasas": 8, "fibra": 2 },
    { "nombre": "ingrediente 2", "gramos": 100, "calorias": 80, "proteinas": 3, "carbohidratos": 15, "grasas": 1, "fibra": 1 }
  ],
  "totales": { "calorias": 280, "proteinas": 15, "carbohidratos": 35, "grasas": 9, "fibra": 3 },
  "calidad": {
    "metabolico": { "nivel": 3, "detalle": "explicación breve" },
    "digestivo": { "nivel": 3, "detalle": "explicación breve" },
    "cardiovascular": { "nivel": 3, "detalle": "explicación breve" }
  }
}

Reglas estrictas:
- Registrá tanto comidas como bebidas: mate, café, té, jugos, gaseosas, agua, cerveza, vino, licuados, etc.
- Ejemplos de bebidas: "mate", "café con leche", "jugo de naranja", "Coca-Cola", "agua con gas", "cerveza", "vino tinto", "licuado de banana".
- Ejemplos de comidas: "milanesa a la napolitana", "asado de tira", "empanadas de carne", "medialunas", "revuelto gramajo", "tarta de acelga", "locro", "choripán", "sorrentinos".
- Usá siempre el nombre más simple y reconocible en rioplatense (ej: "mate", no "infusión de yerba mate").
- Desglosá TODOS los ingredientes visibles con sus gramos estimados para una porción habitual.
- Los valores nutricionales (calorías, proteínas, carbohidratos, grasas, fibra) deben ser por ingrediente según los gramos indicados.
- "totales" es la suma de todos los ingredientes.
- Para el mate sin azúcar, las calorías son prácticamente 0 (~5 kcal). Con azúcar ~20 kcal. Con leche ~80 kcal.
- El campo "confianza" debe ser: "alta" si estás seguro, "media" si tenés dudas, "baja" si no podés identificarlo bien.
- "calidad" evalúa 3 ejes con niveles 1 a 4 (1=Pobre, 2=Regular, 3=Bueno, 4=Excelente):
  - "metabolico": impacto en glucemia y balance energético (carga glucémica, azúcares simples, balance macro)
  - "digestivo": aporte de fibra, fermentados, nivel de procesamiento, impacto en microbiota
  - "cardiovascular": grasas saturadas/trans, sodio, omega-3, colesterol
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
      max_tokens: 1000,
    });

    const content = response.choices[0].message.content.trim();
    const match = content.match(/\{.*\}/s);
    const result = match ? JSON.parse(match[0]) : JSON.parse(content);

    // Ensure required fields
    result.plato = result.plato || 'Plato desconocido';
    result.descripcion = result.descripcion || '';
    result.confianza = result.confianza || 'baja';
    result.ingredientes = result.ingredientes || [];
    result.totales = result.totales || { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0 };
    result.calidad = result.calidad || {
      metabolico: { nivel: 2, detalle: '' },
      digestivo: { nivel: 2, detalle: '' },
      cardiovascular: { nivel: 2, detalle: '' },
    };
    result.calorias = parseInt(result.totales.calorias || result.calorias) || 0;

    for (const ing of result.ingredientes) {
      ing.nombre = ing.nombre || '?';
      ing.gramos = ing.gramos || 0;
      ing.calorias = ing.calorias || 0;
      ing.proteinas = ing.proteinas || 0;
      ing.carbohidratos = ing.carbohidratos || 0;
      ing.grasas = ing.grasas || 0;
      ing.fibra = ing.fibra || 0;
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    return res.status(500).json({ detail: err.message || 'Error analyzing image' });
  }
}
