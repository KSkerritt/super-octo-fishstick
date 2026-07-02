const crypto = require('crypto');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const apiKey = process.env.WIPAY_API_KEY;
    if (!apiKey) {
        console.error('WIPAY_API_KEY environment variable not set');
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valid: false, reason: 'Verification unavailable' })
        };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
    }

    const { transaction_id, total, hash } = body;

    if (!transaction_id || !total || !hash) {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valid: false, reason: 'Missing parameters' })
        };
    }

    // WiPay hash formula: md5(transaction_id + total + api_key) — no separators
    const expected = crypto
        .createHash('md5')
        .update(transaction_id + total + apiKey)
        .digest('hex');

    const valid = expected === hash;

    if (!valid) {
        console.warn('Hash mismatch — possible tampered response', {
            transaction_id,
            total,
            received_hash: hash,
            expected_hash: expected
        });
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid })
    };
};
