exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { imageBase64, mediaType } = JSON.parse(event.body);

        if (!imageBase64 || !mediaType) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing image data' }) };
        }

        const isPDF = mediaType === 'application/pdf';

        const contentBlock = isPDF
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
            : { type: 'image',    source: { type: 'base64', media_type: mediaType,          data: imageBase64 } };

        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        };
        if (isPDF) headers['anthropic-beta'] = 'pdfs-2024-09-25';

        const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        contentBlock,
                        {
                            type: 'text',
                            text: `This is a YUMA Trinidad Carnival costume receipt. Extract the information below and return ONLY valid JSON with no other text.

{
  "order_number": "the order or reference number",
  "customer_name": "the customer full name",
  "costume_type": "costume type such as Male, Hardline, Midline, Monokini, or Body",
  "section": "section name such as Champagne, Legacy, Nirvana, Monaco, etc.",
  "add_ons": "any add-ons listed, or empty string if none",
  "meal_choice": "meal choice if listed, or empty string if none",
  "valid": true or false
}

Set "valid" to true ONLY when BOTH of the following are clearly visible together in the same document:
1. An order number or reference number
2. Costume details including both the section name AND the costume type

If either the order number OR the costume details are absent or unclear, set "valid" to false.
Set any field to null if not found.`
                        }
                    ]
                }]
            })
        });

        if (!apiResponse.ok) {
            const errText = await apiResponse.text();
            console.error('Anthropic API error:', apiResponse.status, errText);
            return { statusCode: 500, body: JSON.stringify({ error: 'Receipt analysis failed' }) };
        }

        const apiData = await apiResponse.json();
        const rawText = apiData.content[0].text.trim();

        let extracted;
        try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            extracted = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        } catch (parseErr) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ valid: false, error: 'Could not read receipt data' })
            };
        }

        const valid = !!(
            extracted.valid &&
            extracted.order_number &&
            extracted.costume_type &&
            extracted.section
        );

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...extracted, valid })
        };

    } catch (err) {
        console.error('Function error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
    }
};
