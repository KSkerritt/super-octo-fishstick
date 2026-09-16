const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLES = {
    INDIVIDUAL: 'Individual Registrations',
    COLLECTORS: 'Group Collectors',
    MEMBERS:    'Group Members',
};

// Netlify stores uploaded files and exposes them as URL strings in the webhook payload.
function attachment(field) {
    if (!field) return undefined;
    const url = typeof field === 'string' ? field : field.url;
    if (!url) return undefined;
    const name = typeof field === 'object' ? field.name : undefined;
    return name ? [{ url, filename: name }] : [{ url }];
}

function clean(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
}

async function airtableCreate(table, fields) {
    const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`,
        {
            method:  'POST',
            headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ fields: clean(fields) }),
        }
    );
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Airtable error ${res.status} on ${table}: ${err}`);
    }
    return res.json(); // { id, fields, createdTime }
}

function mapIndividual(data) {
    const fields = {
        'First Name':          data['First-Name'],
        'Last Name':           data['Last-Name'],
        'Email':               data['E-mail'],
        'Whatsapp Number':     data['Phone-Number'],
        'Street Address':      data['Street'],
        'Building/Apt Number': data['Building'],
        'City':                data['City'],
        'State':               data['State'],
        'Arrival Date':        data['event_date']   || undefined,
        'Section':             data['Section'],
        'Costume Type':        data['Costume Type'],
        'Drop-off Location':   data['Location'],
        'Order Reference No.': data['Order Reference No.'],
        'Payment Status':      'Paid',
    };
    const receipt = attachment(data['Receipt']);
    const id      = attachment(data['Identification']);
    if (receipt) fields['YUMA Receipt'] = receipt;
    if (id)      fields['I.D.']         = id;
    return fields;
}

function mapCollector(data) {
    const fields = {
        'First Name':               data['auth_fname'],
        'Last Name':                data['auth_lname'],
        'Email':                    data['auth_email'],
        'Whatsapp Number':          data['auth_phone'],
        'Secondary Whatsapp Number': data['auth_phone_secondary'],
        'Arrival Date':             data['event_date'] || undefined,
        'Section':                  data['auth_section'],
        'Costume Type':             data['auth_costume'],
        'Drop-off Location':        data['auth_dropoff'],
        'Order Reference No.':      data['auth_order_ref'],
        'Total Group Size':         data['member_count']         ? parseInt(data['member_count'])          : undefined,
        'Payment Status':           'Paid',
    };
    const receipt = attachment(data['auth_receipt']);
    const id      = attachment(data['auth_id']);
    const letter  = attachment(data['auth_letter']);
    if (receipt) fields['YUMA Receipt'] = receipt;
    if (id)      fields['I.D.']         = id;
    if (letter)  fields['Autho Letter'] = letter;
    return fields;
}

function mapMember(data, i, collectorRecordId) {
    const fields = {
        'First Name':          data[`member${i}_fname`],
        'Last Name':           data[`member${i}_lname`],
        'Email':               data[`member${i}_email`],
        'Section':             data[`member${i}_section`],
        'Costume Type':        data[`member${i}_costume`],
        'Order Reference No.': data[`member${i}_order_ref`],
        'Authorized Collector': [{ id: collectorRecordId }],
    };
    const receipt = attachment(data[`member${i}_receipt`]);
    const id      = attachment(data[`member${i}_id`]);
    if (receipt) fields['YUMA Receipt'] = receipt;
    if (id)      fields['I.D.']         = id;
    return fields;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    const formName = payload.form_name;
    const data     = payload.data || {};

    // Drop honeypot-triggered spam
    if (data['bot-field']) {
        console.log('Honeypot triggered — skipping');
        return { statusCode: 200, body: 'OK' };
    }

    try {
        if (formName === 'Registration') {
            await airtableCreate(TABLES.INDIVIDUAL, mapIndividual(data));
            console.log('Individual registration written to Airtable');

        } else if (formName === 'Group Registration') {
            // 1. Create the collector record first to get its Airtable record ID
            const collectorRecord = await airtableCreate(TABLES.COLLECTORS, mapCollector(data));
            const collectorId     = collectorRecord.id;
            console.log('Group collector created:', collectorId);

            // 2. Create a member record for each present member, linked to the collector
            // Count by checking which member slots have a first name populated (max 9)
            for (let i = 1; i <= 9; i++) {
                if (!data[`member${i}_fname`]) continue;
                await airtableCreate(TABLES.MEMBERS, mapMember(data, i, collectorId));
                console.log(`Member ${i} created and linked to collector`);
            }

        } else {
            console.log('Unrecognised form name:', formName);
        }
    } catch (err) {
        console.error('Airtable write failed:', err.message);
        return { statusCode: 500, body: err.message };
    }

    return { statusCode: 200, body: 'OK' };
};
