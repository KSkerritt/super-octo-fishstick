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

IMPORTANT notes about YUMA receipt format:
- The order/reference number is the short alphanumeric code at the top of the receipt (e.g. ME337H3F, MF2J4KP, etc.). It may not be labeled — it is simply the code displayed prominently at the top, often alongside a date.
- The costume product name combines section and costume type together (e.g. "NOIR MALE" means section="Noir", costume_type="Male"). Other examples: "LEGACY HARDLINE" = section="Legacy", costume_type="Hardline". Split them accordingly.
- Add-ons appear under "ADD-ON OPTION". If the value is "NONE" return empty string.
- Meal choices appear under "CARNIVAL MONDAY MENU SELECTION" and "CARNIVAL TUESDAY MENU SELECTION".

{
  "order_number": "the alphanumeric code at the top of the receipt",
  "customer_name": "the masquerader full name",
  "costume_type": "costume type extracted from product name: Male, Hardline, Midline, Monokini, Body, etc.",
  "section": "section name extracted from product name: Noir, Legacy, Champagne, Nirvana, Monaco, etc.",
  "add_ons": "add-on option if any, or empty string",
  "meal_choice": "meal selections if listed, or empty string",
  "valid": true or false
}

Set "valid" to true when BOTH of these are present in the document:
1. An order/reference code (the alphanumeric identifier at the top)
2. A product name that includes costume type and section details

Set "valid" to false only if the document is missing the order code OR is missing any costume/section details entirely.
Set any field to null if genuinely not found.`
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
            extracted.order_number &&
            (extracted.costume_type || extracted.section)
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
