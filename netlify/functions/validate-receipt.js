const VALID_SECTIONS = [
    'champagne', 'faberge', 'juliet rose', 'legacy', 'luxara',
    'merlot', 'monaco', 'nirvana', 'noir', 'pink diamond',
    'panthere', 'reign', 'savage', 'tiffany', 'rii dung'
];

const VALID_COSTUMES = [
    'male', 'hardline', 'hardline 1', 'hardline 2', 'hardline 3',
    'midline', 'midline 1', 'midline 2',
    'monokini', 'monokini 1', 'monokini 2',
    'body 1', 'body 2'
];

function norm(str) {
    return (str || '')
        .toLowerCase()
        .trim()
        .replace(/[àáâãäåæ]/g, 'a')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõöø]/g, 'o')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[ñ]/g, 'n')
        .replace(/[ç]/g, 'c')
        .replace(/\s+/g, ' ');
}

function matchesList(value, list) {
    const v = norm(value);
    if (!v) return false;
    return list.some(item => {
        const n = norm(item);
        return n === v || n.includes(v) || v.includes(n);
    });
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

        const reqHeaders = {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        };
        if (isPDF) reqHeaders['anthropic-beta'] = 'pdfs-2024-09-25';

        console.log('Calling Anthropic API, isPDF:', isPDF);

        const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        contentBlock,
                        {
                            type: 'text',
                            text: `This is a YUMA Trinidad Carnival costume receipt. Extract the fields below and return ONLY valid JSON.

YUMA receipt format:
- The order reference number is the 8-character alphanumeric code at the top (e.g. ME337H3F). It appears alongside a date and is NOT labeled.
- The product name combines section and costume type (e.g. "NOIR MALE" means section="Noir", costume_type="Male").
- Valid sections: Champagne, Fabergè, Juliet Rose, Legacy, Luxara, Merlot, Monaco, Nirvana, Noir, Pink Diamond, Panthére, Reign, Savage, Tiffany, Rii Dung
- Valid costume types: Male, Hardline, Hardline 1, Hardline 2, Hardline 3, Midline, Midline 1, Midline 2, Monokini, Monokini 1, Monokini 2, Body 1, Body 2
- Add-on option appears under "ADD-ON OPTION". Return the value as shown, including "NONE".
- Monday meal: look for any label containing "Monday" and "Menu" or "Selection". Return whatever meal text is listed there.
- Tuesday meal: look for any label containing "Tuesday" and "Menu" or "Selection". Return whatever meal text is listed there.

Return ONLY this JSON, no extra text:
{
  "order_number": "8-character code at top of receipt",
  "customer_name": "masquerader full name",
  "section": "section name only",
  "costume_type": "costume type only",
  "add_ons": "add-on value or null if field absent",
  "meal_monday": "Monday meal selection text or null",
  "meal_tuesday": "Tuesday meal selection text or null"
}`
                        }
                    ]
                }]
            })
        });

        if (!apiResponse.ok) {
            const errText = await apiResponse.text();
            console.error('Anthropic error:', apiResponse.status, errText);
            const serviceMsg = apiResponse.status === 401
                ? 'Receipt verification is temporarily unavailable (configuration issue). Your receipt has not been verified — please try again in a few minutes.'
                : apiResponse.status === 429
                ? 'Receipt verification is temporarily busy. Please wait a moment and try again.'
                : 'Receipt verification is temporarily unavailable. Please try again in a few minutes.';
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    valid: false,
                    reasons: [serviceMsg],
                    debug: { anthropic_status: apiResponse.status, error: errText }
                })
            };
        }

        const apiData = await apiResponse.json();
        const rawText = apiData.content[0].text.trim();
        console.log('Raw model output:', rawText);

        let extracted;
        try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            extracted = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        } catch (parseErr) {
            console.error('JSON parse error:', parseErr, 'Raw:', rawText);
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    valid: false,
                    reasons: ['Could not read receipt data. Please upload a clearer image or PDF.'],
                    debug: { raw: rawText }
                })
            };
        }

        console.log('Extracted:', JSON.stringify(extracted));

        // ── Validation ────────────────────────────────────────────────
        const reasons = [];

        // 1. Order number: exactly 8 alphanumeric characters
        const orderClean = (extracted.order_number || '').trim().replace(/\s/g, '');
        if (!orderClean || !/^[A-Z0-9]{8}$/i.test(orderClean)) {
            reasons.push('Order reference number not found or invalid (expected an 8-character code like ME337H3F at the top of your receipt).');
        }

        // 2. Section must match a known YUMA section
        if (!matchesList(extracted.section, VALID_SECTIONS)) {
            reasons.push('Section not recognised ("' + (extracted.section || 'missing') + '"). Your receipt must show a valid YUMA section name.');
        }

        // 3. Costume type must match a known YUMA costume type
        if (!matchesList(extracted.costume_type, VALID_COSTUMES)) {
            reasons.push('Costume type not recognised ("' + (extracted.costume_type || 'missing') + '"). Your receipt must show a valid YUMA costume type.');
        }

        // 4. Monday meal selection must be present
        if (!extracted.meal_monday || extracted.meal_monday === 'null') {
            reasons.push('Monday menu selection not found. Please ensure your receipt shows your Monday meal choice.');
        }

        // 5. Tuesday meal selection must be present
        if (!extracted.meal_tuesday || extracted.meal_tuesday === 'null') {
            reasons.push('Tuesday menu selection not found. Please ensure your receipt shows your Tuesday meal choice.');
        }

        // 6. Add-on required for all sections except Rii Dung
        const isRiiDung = norm(extracted.section || '').includes('rii dung');
        if (!isRiiDung && extracted.add_ons === null) {
            reasons.push('Add-on option not found. Your receipt should show an add-on option (even if "None").');
        }

        const valid = reasons.length === 0;
        console.log('Valid:', valid, 'Reasons:', reasons);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                valid,
                reasons,
                order_number:  orderClean         || null,
                customer_name: extracted.customer_name || null,
                section:       extracted.section   || null,
                costume_type:  extracted.costume_type || null,
                add_ons:       extracted.add_ons,
                meal_monday:   extracted.meal_monday  || null,
                meal_tuesday:  extracted.meal_tuesday || null,
                debug: { extracted }
            })
        };

    } catch (err) {
        console.error('Function error:', err);
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                valid: false,
                reasons: ['Receipt verification is temporarily unavailable. Please try again in a few minutes.'],
                debug: { error: err.message }
            })
        };
    }
};
