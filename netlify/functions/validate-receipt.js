const VALID_SECTIONS = [
    'champagne', 'faberge', 'fabergè', 'juliet rose', 'legacy', 'luxara',
    'merlot', 'monaco', 'nirvana', 'noir', 'pink diamond', 'panthere',
    'panthére', 'reign', 'savage', 'tiffany', 'rii dung'
];

const VALID_COSTUMES = [
    'male', 'hardline', 'hardline 1', 'hardline 2', 'hardline 3',
    'midline', 'midline 1', 'midline 2',
    'monokini', 'monokini 1', 'monokini 2',
    'body 1', 'body 2'
];

function normalise(str) {
    return (str || '').toLowerCase().trim()
        .replace(/[èé]/g, 'e')
        .replace(/[é]/g, 'e');
}

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
                            text: `This is a YUMA Trinidad Carnival costume receipt. Extract the fields below and return ONLY valid JSON with no other text.

YUMA receipt format notes:
- The order reference number is the 8-character alphanumeric code at the top (e.g. ME337H3F). It is not labeled — it simply appears at the top alongside a date.
- The product name combines section and costume type (e.g. "NOIR MALE" = section "Noir", costume_type "Male"; "LEGACY HARDLINE" = section "Legacy", costume_type "Hardline").
- Valid sections: Champagne, Fabergè, Juliet Rose, Legacy, Luxara, Merlot, Monaco, Nirvana, Noir, Pink Diamond, Panthére, Reign, Savage, Tiffany, Rii Dung.
- Valid costume types: Male, Hardline, Hardline 1, Hardline 2, Hardline 3, Midline, Midline 1, Midline 2, Monokini, Monokini 1, Monokini 2, Body 1, Body 2.
- Add-on option appears under "ADD-ON OPTION". Return the value as-is including "NONE".
- Meal selections appear under "CARNIVAL MONDAY MENU SELECTION" / "Monday Menu Selection" and "CARNIVAL TUESDAY MENU SELECTION" / "Tuesday Menu Selection". Extract both separately.

Return this exact JSON structure:
{
  "order_number": "the 8-character alphanumeric code at the top",
  "customer_name": "masquerader full name",
  "section": "section name only (not the full product name)",
  "costume_type": "costume type only (not the full product name)",
  "add_ons": "add-on value or null if field not present on receipt",
  "meal_monday": "Monday menu selection text or null if not found",
  "meal_tuesday": "Tuesday menu selection text or null if not found"
}`
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

        const apiData  = await apiResponse.json();
        const rawText  = apiData.content[0].text.trim();

        let extracted;
        try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            extracted = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        } catch (parseErr) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ valid: false, reasons: ['Could not read receipt data. Please try a clearer image.'] })
            };
        }

        // ── Validation checks ──────────────────────────────────────────
        const reasons = [];

        // 1. Order number must be exactly 8 alphanumeric characters
        if (!extracted.order_number || !/^[A-Z0-9]{8}$/i.test(extracted.order_number.trim())) {
            reasons.push('Order reference number not found or invalid. It should be the 8-character code at the top of your receipt.');
        }

        // 2. Section must be a known YUMA section
        const sectionNorm = normalise(extracted.section);
        if (!sectionNorm || !VALID_SECTIONS.some(s => normalise(s) === sectionNorm)) {
            reasons.push('Section name not recognised (' + (extracted.section || 'missing') + '). Please ensure your receipt shows a valid YUMA section.');
        }

        // 3. Costume type must be a known YUMA costume type
        const costumeNorm = normalise(extracted.costume_type);
        if (!costumeNorm || !VALID_COSTUMES.some(c => normalise(c) === costumeNorm)) {
            reasons.push('Costume type not recognised (' + (extracted.costume_type || 'missing') + '). Please ensure your receipt shows a valid YUMA costume type.');
        }

        // 4. Meal selections must be present (both Monday and Tuesday)
        if (!extracted.meal_monday) {
            reasons.push('Monday menu selection not found. Please ensure your receipt includes your Monday meal choice.');
        }
        if (!extracted.meal_tuesday) {
            reasons.push('Tuesday menu selection not found. Please ensure your receipt includes your Tuesday meal choice.');
        }

        // 5. Add-on must be present unless section is Rii Dung (which has no add-on field)
        const isRiiDung = sectionNorm.includes('rii dung');
        if (!isRiiDung && extracted.add_ons === null) {
            reasons.push('Add-on option not found. Your receipt should show an add-on option (even if it is "None").');
        }

        const valid = reasons.length === 0;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                valid,
                reasons,
                order_number:  extracted.order_number  || null,
                customer_name: extracted.customer_name || null,
                section:       extracted.section       || null,
                costume_type:  extracted.costume_type  || null,
                add_ons:       extracted.add_ons,
                meal_monday:   extracted.meal_monday   || null,
                meal_tuesday:  extracted.meal_tuesday  || null
            })
        };

    } catch (err) {
        console.error('Function error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
    }
};
