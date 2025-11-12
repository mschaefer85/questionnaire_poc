const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = 'gpt-4.1-mini';
const OPENAI_EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_DOCUMENT_CHARS = 15000;
const CHUNK_CHAR_LIMIT = 1200;
const CHUNK_CHAR_OVERLAP = 150;
const MAX_CONTEXT_CHUNKS = 5;
const EMBEDDING_BATCH_SIZE = 8;
const MIN_SIMILARITY_THRESHOLD = 0.18;

const PDF_JS_VERSION = '4.2.67';

if (window.pdfjsLib?.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}/pdf.worker.min.js`;
}

const telemetryState = {
  calls: [],
};

const viewState = {
  active: null,
};

function generateTelemetryId() {
  return `call-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeUsage(usage) {
  if (!usage) {
    return null;
  }

  const input =
    usage.input_tokens ?? usage.prompt_tokens ?? usage.total_tokens ?? null;
  const output = usage.output_tokens ?? usage.completion_tokens ?? null;
  const total =
    usage.total_tokens ??
    (Number.isFinite(input) || Number.isFinite(output)
      ? (Number.isFinite(input) ? input : 0) +
        (Number.isFinite(output) ? output : 0)
      : null);

  return {
    input: Number.isFinite(input) ? input : null,
    output: Number.isFinite(output) ? output : null,
    total: Number.isFinite(total) ? total : null,
  };
}

function recordOpenAiCall(entry) {
  const call = {
    id: entry.id || generateTelemetryId(),
    timestamp: entry.timestamp || new Date().toISOString(),
    type: entry.type || 'openai',
    subtype: entry.subtype || '',
    description: entry.description || '',
    questionNumber: entry.questionNumber || '',
    questionText: entry.questionText || '',
    contextCount: Number.isFinite(entry.contextCount) ? entry.contextCount : 0,
    payloadSize: Number.isFinite(entry.payloadSize)
      ? entry.payloadSize
      : Number(entry.payloadSize) || 0,
    status: entry.status || 'pending',
    httpStatus: typeof entry.httpStatus === 'number' ? entry.httpStatus : null,
    tokens: entry.tokens || null,
    responsePreview: entry.responsePreview || '',
    errorMessage: entry.errorMessage || '',
    durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
    aiDecision: entry.aiDecision || null,
  };

  telemetryState.calls.push(call);
  if (telemetryState.calls.length > 200) {
    telemetryState.calls.splice(0, telemetryState.calls.length - 200);
  }

  updateAdminLog();
  return call.id;
}

function updateTelemetryEntry(callId, updates) {
  if (!callId || !updates) {
    return;
  }

  const entry = telemetryState.calls.find((call) => call.id === callId);
  if (!entry) {
    return;
  }

  Object.keys(updates).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      entry[key] = updates[key];
    }
  });

  updateAdminLog();
}

function escapeHtml(value) {
  if (value == null) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return '—';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(isoString);
  }
  return date.toLocaleString(undefined, { hour12: false });
}

function formatTokensDisplay(tokens) {
  if (!tokens) {
    return '<span class="muted">–</span>';
  }

  const { input, output, total } = tokens;
  const hasValues = [input, output, total].some((value) =>
    Number.isFinite(value)
  );

  if (!hasValues) {
    return '<span class="muted">–</span>';
  }

  const totalLabel = Number.isFinite(total)
    ? total.toLocaleString()
    : '—';

  const detailParts = [];
  if (Number.isFinite(input)) {
    detailParts.push(`in ${input.toLocaleString()}`);
  }
  if (Number.isFinite(output)) {
    detailParts.push(`out ${output.toLocaleString()}`);
  }

  const detailText = detailParts.length
    ? detailParts.join(' · ')
    : 'tokens';

  return `<div class="token-metric"><strong>${totalLabel}</strong><span>${escapeHtml(
    detailText
  )}</span></div>`;
}

function updateAdminLog() {
  const summaryEl = document.getElementById('admin-summary');
  const tableBody = document.getElementById('admin-table-body');

  if (!summaryEl || !tableBody) {
    return;
  }

  if (!telemetryState.calls.length) {
    summaryEl.textContent = 'No OpenAI activity recorded yet.';
    tableBody.innerHTML =
      '<tr class="empty-row"><td colspan="6">No calls yet.</td></tr>';
    return;
  }

  const totals = telemetryState.calls.reduce(
    (acc, call) => {
      if (call.status === 'success') {
        acc.success += 1;
      } else if (call.status === 'error') {
        acc.error += 1;
      }

      if (call.tokens) {
        const { input, output, total } = call.tokens;
        if (Number.isFinite(input)) {
          acc.input += input;
        }
        if (Number.isFinite(output)) {
          acc.output += output;
        }
        if (Number.isFinite(total)) {
          acc.total += total;
        } else {
          if (Number.isFinite(input)) {
            acc.total += input;
          }
          if (Number.isFinite(output)) {
            acc.total += output;
          }
        }
      }

      return acc;
    },
    { success: 0, error: 0, input: 0, output: 0, total: 0 }
  );

  const totalTokensLabel = totals.total
    ? `${totals.total.toLocaleString()} tokens`
    : '0 tokens';

  summaryEl.innerHTML = `
    <strong>${telemetryState.calls.length}</strong> call${
    telemetryState.calls.length === 1 ? '' : 's'
  }
    • <span>${totals.success} succeeded</span>
    • <span>${totals.error} failed</span>
    • <span>${escapeHtml(totalTokensLabel)}</span>
  `.trim();

  const rows = telemetryState.calls
    .slice()
    .reverse()
    .map((call) => {
      const endpointLabel =
        call.type === 'embeddings'
          ? 'Embeddings'
          : call.type === 'responses'
          ? 'Responses'
          : escapeHtml(call.type);

      const contextParts = [];
      if (call.questionNumber) {
        contextParts.push(`Q${escapeHtml(call.questionNumber)}`);
      }
      if (call.description) {
        contextParts.push(escapeHtml(call.description));
      } else if (call.questionText) {
        contextParts.push(escapeHtml(call.questionText));
      }

      const metaParts = [];
      if (call.contextCount) {
        metaParts.push(
          `${call.contextCount} excerpt${call.contextCount === 1 ? '' : 's'}`
        );
      }
      if (call.payloadSize) {
        metaParts.push(`${call.payloadSize.toLocaleString()} chars`);
      }

      const contextText = [
        contextParts.join(' • '),
        metaParts.length ? `(${metaParts.join(', ')})` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const statusClass =
        call.status === 'success'
          ? 'status-success'
          : call.status === 'error'
          ? 'status-error'
          : 'status-pending';
      const statusLabel =
        call.status === 'success'
          ? 'Success'
          : call.status === 'error'
          ? 'Error'
          : 'Pending';

      const statusMeta = [];
      if (call.httpStatus) {
        statusMeta.push(`HTTP ${call.httpStatus}`);
      }
      if (Number.isFinite(call.durationMs)) {
        statusMeta.push(`${call.durationMs} ms`);
      }

      const statusExtra = statusMeta.length
        ? `<span class="status-extra">${escapeHtml(
            statusMeta.join(' · ')
          )}</span>`
        : '';

      const detailParts = [];
      if (call.status === 'error' && call.errorMessage) {
        detailParts.push(call.errorMessage);
      }
      if (call.aiDecision) {
        const answerValue = call.aiDecision.answerValue;
        const answerLabelText = call.aiDecision.answerLabel;
        let answerSummary = 'No answer';
        if (answerValue) {
          answerSummary = `Answer ${answerValue}`;
          if (answerLabelText) {
            answerSummary += ` • ${answerLabelText}`;
          }
        }
        detailParts.push(answerSummary);
        if (call.aiDecision.reason) {
          detailParts.push(call.aiDecision.reason);
        }
      } else if (call.responsePreview) {
        detailParts.push(call.responsePreview);
      }

      const detailText = detailParts
        .filter(Boolean)
        .map((part) => escapeHtml(part))
        .join('\n');

      return `
        <tr>
          <td>${formatTimestamp(call.timestamp)}</td>
          <td>${endpointLabel}</td>
          <td>${contextText ? contextText : '<span class="muted">—</span>'}</td>
          <td>
            <span class="status-pill ${statusClass}">${statusLabel}</span>
            ${statusExtra}
          </td>
          <td>${formatTokensDisplay(call.tokens)}</td>
          <td><span class="details-text">${
            detailText || '<span class="muted">—</span>'
          }</span></td>
        </tr>
      `;
    })
    .join('');

  tableBody.innerHTML = rows;
}

function switchAppView(target) {
  if (!target || viewState.active === target) {
    return;
  }

  const sections = document.querySelectorAll('.app-view');
  sections.forEach((section) => {
    const isActive = section.dataset.view === target;
    section.hidden = !isActive;
    section.classList.toggle('active', isActive);
  });

  const buttons = document.querySelectorAll('[data-view-target]');
  buttons.forEach((button) => {
    const isActive = button.dataset.viewTarget === target;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  viewState.active = target;
}

function setupViewNavigation() {
  const buttons = document.querySelectorAll('[data-view-target]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.viewTarget;
      switchAppView(view);
    });
  });
}

async function performOpenAiCall({ endpoint, payload, apiKey, meta = {} }) {
  const callId = meta.id || generateTelemetryId();
  const startTime =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  const timestamp = new Date().toISOString();
  const requestBody = JSON.stringify(payload);
  let response;
  let responseData = null;
  let logged = false;

  const baseLog = {
    id: callId,
    timestamp,
    type: meta.type || 'openai',
    subtype: meta.subtype || '',
    description: meta.description || '',
    questionNumber: meta.questionNumber || '',
    questionText: meta.questionText || '',
    contextCount: Array.isArray(meta.contextChunks)
      ? meta.contextChunks.length
      : Number.isFinite(meta.contextCount)
      ? meta.contextCount
      : 0,
    payloadSize: requestBody.length,
  };

  const logCall = (fields) => {
    logged = true;
    recordOpenAiCall({
      ...baseLog,
      durationMs: Math.round(
        (typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now()) - startTime
      ),
      ...fields,
    });
  };

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
    });

    const responseText = await response.text();
    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        responseData = null;
      }
    }

    const tokens = normalizeUsage(responseData?.usage);

    if (!response.ok) {
      const errorMessage =
        responseData?.error?.message ||
        `Request failed with status ${response.status}`;
      logCall({
        status: 'error',
        httpStatus: response.status,
        tokens,
        responsePreview: responseData?.error?.message || '',
        errorMessage,
      });
      throw new Error(errorMessage);
    }

    const preview = meta.previewExtractor
      ? meta.previewExtractor(responseData) || ''
      : '';

    logCall({
      status: 'success',
      httpStatus: response.status,
      tokens,
      responsePreview: preview,
    });

    return { data: responseData, callId };
  } catch (error) {
    if (!logged) {
      logCall({
        status: 'error',
        httpStatus: response ? response.status : null,
        tokens: normalizeUsage(responseData?.usage),
        responsePreview: '',
        errorMessage: error.message || 'Request failed',
      });
    }
    throw error;
  }
}

const documentState = {
  name: '',
  size: 0,
  content: '',
  truncated: false,
  chunks: [],
  embeddings: [],
  embeddingModel: '',
};

const questionnaireSections = [
  {
    title: '1. CSDDD Scope',
    questions: [
      {
        number: '1.1',
        text:
          'Does your company fall under the scope of the CSDDD? (Please find the scope definition above.)',
        options: [
          { value: 'A', label: 'A: Yes', score: 0 },
          { value: 'B', label: 'B: No', score: 0 },
        ],
      },
    ],
  },
  {
    title: '2. General',
    questions: [
      {
        number: '2.1',
        text:
          'Does your company or your upstream suppliers source, process, or use raw materials, products, or services that may be associated with significant human rights or environmental risks?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: No', score: 0 },
        ],
      },
      {
        number: '2.2',
        text:
          'If your company is formed under the legislation of a third country (non-EU): Has your company designated an authorised representative (natural or legal person) established or domiciled in the EU Member State where the company operates?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: No', score: 0 },
          { value: 'C', label: 'C: Not applicable', score: 0 },
        ],
      },
    ],
  },
  {
    title: '3. Due Diligence System',
    questions: [
      {
        number: '3.1',
        text:
          'Does your company have a due diligence strategy that is integrated into its policies and risk management systems to ensure a risk-based approach?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: In development', score: 1 },
          { value: 'C', label: 'C: No', score: 0 },
        ],
      },
      {
        number: '3.2.1',
        text:
          'Has your company adopted a written corporate policy outlining its commitment to human rights in line with the CSDDD?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: In development', score: 1 },
          { value: 'C', label: 'C: No', score: 0 },
        ],
      },
      {
        number: '3.2.2',
        text:
          'Has your company aligned the written corporate policy outlining its commitment to human rights in line with the CSDDD with its internal stakeholders?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: No', score: 0 },
        ],
      },
      {
        number: '3.3',
        text:
          'Has your company adopted a written corporate policy outlining its commitment to environmental due diligence in line with the CSDDD?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: In development', score: 1 },
          { value: 'C', label: 'C: No', score: 0 },
        ],
      },
      {
        number: '3.4',
        text:
          'Is there a defined process for reviewing and updating this policy at least every two years or upon regulatory changes?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: No', score: 0 },
        ],
      },
      {
        number: '3.5',
        text:
          'Does your company have a notification mechanism or complaints procedure for reporting actual or potential adverse effects on human rights and/or the environment?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: In development', score: 1 },
          { value: 'C', label: 'C: No', score: 0 },
        ],
      },
      {
        number: '3.6',
        text:
          'Does your company have a Code of Conduct, that covers the human rights aspects required under the CSDDD?',
        options: [
          { value: 'A', label: 'A: Yes, fully covered', score: 2 },
          { value: 'B', label: 'B: Partially covered', score: 1 },
          { value: 'C', label: 'C: No, not covered', score: 0 },
        ],
      },
      {
        number: '3.7',
        text:
          'Does your company have a Code of Conduct, that covers the environmental aspects required under the CSDDD?',
        options: [
          { value: 'A', label: 'A: Yes, fully covered', score: 2 },
          { value: 'B', label: 'B: Partially covered', score: 1 },
          { value: 'C', label: 'C: No, not covered', score: 0 },
        ],
      },
      {
        number: '3.8',
        text:
          'Does your company share a Supplier Code of Conduct with its suppliers to comply with the human rights and environmental standards set out in the CSDDD and do you have process to obtain suppliers acknowledgement?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: In development', score: 1 },
          { value: 'C', label: 'C: No', score: 0 },
        ],
      },
      {
        number: '3.9',
        text:
          'Does your company take measures to map its own operations, those of your subsidiaries and those of business partners?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: In development', score: 1 },
          { value: 'C', label: 'C: No', score: 0 },
        ],
      },
      {
        number: '3.10',
        text:
          'Is your due diligence system reviewed at least annually or upon relevant changes (e.g. new suppliers, legal updates)?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: In development', score: 1 },
          { value: 'C', label: 'C: No', score: 0 },
        ],
      },
      {
        number: '3.11',
        text:
          'Does your company retain all documentation related to the due diligence system (e.g. risk assessments, decisions, supplier evaluations) for at least five years?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: No', score: 0 },
        ],
      },
      {
        number: '3.12',
        text:
          'Does your company take appropriate measures to ensure meaningful engagement with stakeholders (e.g., surveys, stakeholder committees)?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: No', score: 0 },
        ],
      },
      {
        number: '3.13',
        text:
          'Has your company published an annual report that includes information on its due diligence system and measures taken to ensure compliance with human rights and environmental obligations?',
        options: [
          { value: 'A', label: 'A: Yes', score: 2 },
          { value: 'B', label: 'B: No', score: 0 },
        ],
      },
    ],
  },
  {
    title: '4. Risk Analysis',
    subsections: [
      {
        title: '4.1 Risk Management and Response Process',
        questions: [
          {
            number: '4.1.1',
            text:
              'Does your company assess and prioritise human right and environmental risks based on severity (e.g. scale, scope, irreversibility, number of people affected, or environmental damage) and likelihood?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: Only human rights risk/environmental risk', score: 1 },
              { value: 'C', label: 'C: No', score: 0 },
            ],
          },
          {
            number: '4.1.2',
            text: 'Does your company utilize highly qualified sources for the risk assessment?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: No', score: 0 },
            ],
          },
          {
            number: '4.2',
            text: 'Does your company reassess identified human rights and environmental risks?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: No', score: 0 },
            ],
          },
          {
            number: '4.3',
            text:
              'Has your company implemented mitigation measures for identified risks, including procedures for disengagement if no acceptable risk level can be achieved?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: In development', score: 1 },
              { value: 'C', label: 'C: No', score: 0 },
            ],
          },
          {
            number: '4.4',
            text:
              'Has your company implemented preventive measures to address human rights risks as defined under the CSDDD?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: No', score: 0 },
            ],
          },
          {
            number: '4.5',
            text:
              'Has your company implemented preventive measures to address environmental risks as defined under the CSDDD?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: No', score: 0 },
            ],
          },
          {
            number: '4.6',
            text:
              'Is a regular assessment of adequacy and effectiveness of mitigation and remediation measures carried out?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: No', score: 0 },
            ],
          },
          {
            number: '4.7',
            text:
              'Does your company hold certifications specifically covering the obligations regarding adverse impacts on human rights required under the CSDDD?',
            options: [
              { value: 'A', label: 'A: Yes, fully covered', score: 2 },
              { value: 'B', label: 'B: Partially covered', score: 1 },
              { value: 'C', label: 'C: No, not covered', score: 0 },
            ],
          },
          {
            number: '4.8',
            text:
              'Does your company hold certifications specifically covering the obligations regarding adverse impacts on the environment required under the CSDDD?',
            options: [
              { value: 'A', label: 'A: Yes, fully covered', score: 2 },
              { value: 'B', label: 'B: Partially covered', score: 1 },
              { value: 'C', label: 'C: No, not covered', score: 0 },
            ],
          },
          {
            number: '4.9',
            text:
              'Has your company adopted and implemented a transition plan for climate change mitigation to ensure that your business model and strategy are aligned with the goals of the Paris Agreement (limiting global warming to 1.5°C) and the EU climate neutrality targets for 2030 and 2050?',
            options: [
              { value: 'A', label: 'A: Yes', score: 2 },
              { value: 'B', label: 'B: In development', score: 1 },
              { value: 'C', label: 'C: No', score: 0 },
            ],
          },
        ],
      },
      {
        title: '4.2 Risk Assessment Results Human Rights',
        questions: [
          {
            number: '4.2.1',
            text:
              'Is your own business area or your supply chain exposed to risks related to the violation of the right to life (e.g., life threatening safety risks, exposure to harmful substances at work, possible abuses by suppliers)?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.2',
            text:
              'Is your own business area or your supply chain exposed to risks related to torture, cruel, inhuman or degrading treatment?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.3',
            text:
              'Is your own business area or your supply chain exposed to risks related to the violation of the right to liberty and security?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.4',
            text:
              "Is your own business area or your supply chain exposed to risks related to the unlawful interference with a person's privacy, family, home or correspondence and attacks on their honour or reputation?",
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.5',
            text:
              'Is your own business area or your supply chain exposed to risks related to the violation of the freedom of thought, conscience and religion?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.6',
            text:
              'Is your own business area or your supply chain exposed to risks related to the right to just and favourable conditions of work?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.7',
            text:
              'Is your own business area or your supply chain exposed to risks related to the violation of the protection of workers’ access to adequate housing, food and basic needs?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.8',
            text:
              'Is your own business area or your supply chain exposed to risks related to the violation of the rights of the child (including health, education, protection and a decent standard of living)?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.9',
            text:
              'Is your own business area or your supply chain exposed to risks related to the employment of a child under the age at which compulsory schooling is completed?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.10',
            text:
              'Is your own business area or your supply chain exposed to risks of the worst forms of child labour?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.11',
            text:
              'Is your own business area or your supply chain exposed to risks of forced or compulsory labour?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.12',
            text:
              'Is your company exposed to risks related to the prohibition of all forms of slavery and slave-trade?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.13',
            text:
              'Is your own business area or your supply chain exposed to risks related to the disregard of the freedom of association, assembly, and collective bargaining?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.14',
            text:
              'Is your own business area or your supply chain exposed to risks of unequal treatment in employment?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.15',
            text:
              'Is your own business area or your supply chain exposed to risks of measurable environmental degradation that harms human rights?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.16',
            text:
              'Is your own business area or your supply chain exposed to risks related to the right to land, natural resources, and livelihood security?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
        ],
      },
      {
        title: '4.2 Risk Identification Environmental Risks',
        questions: [
          {
            number: '4.2.1 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks of causing biodiversity impacts, such as those addressed by the CBD (Cartagena or Nagoya Protocols)?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.2 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to trading in CITES-listed species without the required permits?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.3 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the manufacture, import, or export of mercury-added products as listed in the Minamata Convention on Mercury?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.4 (Env)',
            text:
              'Is your company exposed to risks related to the use of mercury or mercury compounds in manufacturing processes listed in the Minamata Convention on Mercury?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.5 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the unlawful treatment of mercury waste, as prohibited by the Minamata Convention?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.6 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the production or use of persistent organic pollutants (POPs)?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.7 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the unlawful handling, collection, storage, or disposal of persistent organic pollutants (POPs)?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.8 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the export or import of chemicals covered by the Rotterdam Convention?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.9 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the unlawful production, consumption, import or export of ozone-depleting substances covered by the Montreal Protocol?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.10 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the export of hazardous or other waste, as prohibited in the Basel Convention?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.11 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the export of hazardous waste to countries listed in the Basel Convention?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.12 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to the import of hazardous waste or other waste from a non-party that has not ratified the Basel Convention?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.13 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks of impacting natural heritage sites, as defined by the World Heritage Convention?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.14 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks of adversely impacting wetlands, as designated under the Ramsar Convention?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.15 (Env)',
            text:
              'Is your own business area or your supply chain exposed to risks related to pollution from ships, as regulated under the International Convention for the Prevention of Pollution from Ships (MARPOL)?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
          {
            number: '4.2.16 (Env)',
            text:
              'Is your company or your supply chain exposed to risks related to the dumping of waste or other matter that could cause pollution of the marine environment, as prohibited by the United Nations Convention on the Law of the Sea (UNCLOS)?',
            options: [
              { value: 'A', label: 'A: Both - Own business area and supply chain', score: 0 },
              { value: 'B', label: 'B: Yes - Own business area', score: 0 },
              { value: 'C', label: 'C: Yes - Supply chain', score: 0 },
              { value: 'D', label: 'D: No', score: 2 },
            ],
          },
        ],
      },
    ],
  },
];

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} MB`;
}

function isProbablyPdf(file) {
  if (!file) {
    return false;
  }
  if (file.type === 'application/pdf') {
    return true;
  }
  return /\.pdf$/i.test(file.name || '');
}

function normalizeDocumentText(text) {
  if (!text) {
    return '';
  }

  const withoutNulls = text.replace(/\u0000/g, ' ');
  const normalizedLineBreaks = withoutNulls
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = normalizedLineBreaks
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, arr) => line.length > 0 || (index > 0 && arr[index - 1].length > 0));

  return lines.join('\n').trim();
}

function chunkDocumentContent(text, chunkSize = CHUNK_CHAR_LIMIT, overlap = CHUNK_CHAR_OVERLAP) {
  if (!text) {
    return [];
  }

  const sanitized = text.trim();
  if (!sanitized) {
    return [];
  }

  const chunks = [];
  let start = 0;
  let index = 0;

  while (start < sanitized.length) {
    let end = Math.min(sanitized.length, start + chunkSize);
    let chunk = sanitized.slice(start, end);

    if (end < sanitized.length) {
      const lastBreak = chunk.lastIndexOf('\n');
      if (lastBreak > chunkSize * 0.5) {
        chunk = chunk.slice(0, lastBreak);
        end = start + chunk.length;
      }
    }

    const trimmedChunk = chunk.trim();
    if (trimmedChunk) {
      chunks.push({
        id: `chunk-${index + 1}`,
        text: trimmedChunk,
        start,
        end,
      });
      index += 1;
    }

    if (end >= sanitized.length) {
      break;
    }

    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function embedTexts(texts, apiKey, meta = {}) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const { data } = await performOpenAiCall({
    endpoint: OPENAI_EMBEDDING_ENDPOINT,
    apiKey,
    payload: {
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    },
    meta: {
      type: 'embeddings',
      subtype: meta.purpose || 'document',
      description: meta.description || '',
      questionNumber: meta.questionNumber || '',
      questionText: meta.questionText || '',
      contextCount: meta.contextCount ?? texts.length,
    },
  });

  if (!data || !Array.isArray(data.data)) {
    throw new Error('Embedding response was malformed.');
  }

  return data.data.map((item) => item.embedding || []);
}

function dotProduct(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i] * b[i];
  }
  return total;
}

function vectorMagnitude(vector) {
  if (!vector || vector.length === 0) {
    return 0;
  }
  return Math.sqrt(dotProduct(vector, vector));
}

function cosineSimilarity(a, b) {
  const denominator = vectorMagnitude(a) * vectorMagnitude(b);
  if (denominator === 0) {
    return 0;
  }
  return dotProduct(a, b) / denominator;
}

async function ensureDocumentEmbeddings(apiKey, statusEl) {
  if (!documentState.content) {
    throw new Error('No document available for indexing.');
  }

  if (!Array.isArray(documentState.chunks) || documentState.chunks.length === 0) {
    documentState.chunks = chunkDocumentContent(documentState.content);
  }

  if (!documentState.chunks.length) {
    throw new Error('The document did not yield any searchable chunks.');
  }

  if (
    Array.isArray(documentState.embeddings) &&
    documentState.embeddings.length === documentState.chunks.length &&
    documentState.embeddingModel === OPENAI_EMBEDDING_MODEL
  ) {
    return;
  }

  if (statusEl) {
    setAiStatus(statusEl, 'info', 'Indexing document for semantic search…');
  }

  const embeddings = [];
  for (let i = 0; i < documentState.chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = documentState.chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const rangeStart = i + 1;
    const rangeEnd = Math.min(
      i + EMBEDDING_BATCH_SIZE,
      documentState.chunks.length
    );
    const batchEmbeddings = await embedTexts(
      batch.map((chunk) => chunk.text),
      apiKey,
      {
        purpose: 'document-index',
        description: `Chunks ${rangeStart}-${rangeEnd}`,
        contextCount: batch.length,
      }
    );
    embeddings.push(...batchEmbeddings);
  }

  if (embeddings.length !== documentState.chunks.length) {
    throw new Error('Mismatch between chunks and embeddings.');
  }

  documentState.embeddings = embeddings;
  documentState.embeddingModel = OPENAI_EMBEDDING_MODEL;
  updateDocumentPreview();
}

async function gatherContextForQuestion(question, apiKey, statusEl) {
  await ensureDocumentEmbeddings(apiKey, statusEl);

  if (!documentState.embeddings || documentState.embeddings.length === 0) {
    return [];
  }

  if (statusEl) {
    setAiStatus(statusEl, 'info', 'Searching document for relevant evidence…');
  }

  const queryText = `${question.number || 'Question'}: ${question.text}`;
  const [questionEmbedding] = await embedTexts([queryText], apiKey, {
    purpose: 'question-query',
    description: 'Question embedding',
    questionNumber: question.number || '',
    questionText: question.text || '',
    contextCount: 1,
  });

  if (!questionEmbedding || questionEmbedding.length === 0) {
    return [];
  }

  const scored = documentState.embeddings.map((embedding, index) => ({
    chunk: documentState.chunks[index],
    score: cosineSimilarity(questionEmbedding, embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  const relevant = scored
    .slice(0, Math.min(MAX_CONTEXT_CHUNKS, scored.length))
    .filter((item) => Number.isFinite(item.score) && item.score >= MIN_SIMILARITY_THRESHOLD)
    .map((item, index) => ({
      id: item.chunk.id,
      text: item.chunk.text,
      score: item.score,
      order: index + 1,
    }));

  return relevant;
}

async function extractTextFromPdf(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
    throw new Error('PDF.js is not available to read PDF documents.');
  }

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const textChunks = [];
  let totalLength = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .filter(Boolean);

    if (!strings.length) {
      continue;
    }

    const pageText = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (!pageText) {
      continue;
    }

    const chunk = `${pageText}\n\n`;
    textChunks.push(chunk);
    totalLength += chunk.length;

    if (totalLength > MAX_DOCUMENT_CHARS * 1.5) {
      break;
    }
  }

  const combined = textChunks.join('').trim();
  if (!combined) {
    throw new Error('No readable text found in the PDF.');
  }

  return combined;
}

async function readFileAsText(file) {
  if (!file) {
    return '';
  }

  if (isProbablyPdf(file)) {
    return extractTextFromPdf(file);
  }

  if (typeof file.type === 'string' && file.type.startsWith('text/')) {
    return file.text();
  }

  if (/\.(txt|md|csv|json|html?|rtf)$/i.test(file.name || '')) {
    return file.text();
  }

  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(buffer);
}

function updateDocumentPreview(message) {
  const preview = document.getElementById('document-preview');
  const clearButton = document.getElementById('clear-document');

  if (!preview) {
    return;
  }

  if (message) {
    preview.textContent = message;
    if (clearButton) {
      clearButton.hidden = true;
    }
    return;
  }

  if (documentState.content) {
    const sizeLabel = formatFileSize(documentState.size);
    const charCount = documentState.content.length.toLocaleString();
    const parts = [];

    parts.push(`<strong>${documentState.name || 'Uploaded document'}</strong>`);
    if (sizeLabel) {
      parts.push(sizeLabel);
    }
    parts.push(`${charCount} characters analysed`);
    if (Array.isArray(documentState.chunks) && documentState.chunks.length) {
      parts.push(`${documentState.chunks.length} context chunks`);
    }

    if (
      Array.isArray(documentState.embeddings) &&
      documentState.embeddings.length === documentState.chunks.length &&
      documentState.embeddingModel === OPENAI_EMBEDDING_MODEL
    ) {
      parts.push('Semantic index ready');
    }

    let details = parts.join(' • ');
    if (documentState.truncated) {
      details +=
        ' <span class="truncate-note">(truncated for analysis)</span>';
    }

    preview.innerHTML = details;

    if (clearButton) {
      clearButton.hidden = false;
    }
  } else {
    preview.textContent = 'No document uploaded yet.';
    if (clearButton) {
      clearButton.hidden = true;
    }
  }
}

function clearDocument() {
  documentState.name = '';
  documentState.size = 0;
  documentState.content = '';
  documentState.truncated = false;
  documentState.chunks = [];
  documentState.embeddings = [];
  documentState.embeddingModel = '';

  const uploadInput = document.getElementById('document-upload');
  if (uploadInput) {
    uploadInput.value = '';
  }
}

async function handleDocumentUpload(event) {
  const file = event.target?.files?.[0];

  if (!file) {
    clearDocument();
    updateDocumentPreview();
    return;
  }

  updateDocumentPreview('Reading document…');

  try {
    const rawText = await readFileAsText(file);
    const normalizedText = normalizeDocumentText(rawText);

    if (!normalizedText) {
      throw new Error('No readable text extracted from document.');
    }

    const truncated = normalizedText.length > MAX_DOCUMENT_CHARS;
    const usableText = truncated
      ? normalizedText.slice(0, MAX_DOCUMENT_CHARS)
      : normalizedText;

    documentState.name = file.name;
    documentState.size = file.size;
    documentState.content = usableText;
    documentState.truncated = truncated;
    documentState.chunks = chunkDocumentContent(usableText);
    documentState.embeddings = [];
    documentState.embeddingModel = '';

    updateDocumentPreview();
  } catch (error) {
    console.error('Failed to read document', error);
    clearDocument();
    updateDocumentPreview(
      'Unable to extract readable text from this document. Try a PDF with selectable text or a plain-text file.'
    );
  }
}

function setupControlPanel() {
  const uploadInput = document.getElementById('document-upload');
  const clearButton = document.getElementById('clear-document');

  if (uploadInput) {
    uploadInput.addEventListener('change', handleDocumentUpload);
  }

  if (clearButton) {
    clearButton.addEventListener('click', () => {
      clearDocument();
      updateDocumentPreview();
    });
  }

  updateDocumentPreview();
}

function getApiKey() {
  const input = document.getElementById('api-key');
  return input ? input.value.trim() : '';
}

function setAiStatus(element, variant, message) {
  if (!element) {
    return;
  }
  element.className = variant ? `ai-status ${variant}` : 'ai-status';
  element.textContent = message;
}

function buildAiPrompt(question, contextChunks) {
  const optionsSummary = question.options
    .map((option) => `${option.value}: ${option.label}`)
    .join('\n');

  const truncatedNote = documentState.truncated
    ? 'The document was truncated to fit the token limit. Base your decision only on the provided excerpt.'
    : '';

  const evidenceBlock = Array.isArray(contextChunks) && contextChunks.length > 0
    ? contextChunks
        .map((chunk) => {
          const similarityLabel =
            typeof chunk.score === 'number' && Number.isFinite(chunk.score)
              ? chunk.score.toFixed(2)
              : 'n/a';
          return `Excerpt ${chunk.order} (similarity ${similarityLabel}):\n${chunk.text}`;
        })
        .join('\n\n')
    : 'No relevant excerpts were retrieved. If no evidence is provided, respond with canAnswer = false.';

  return `You are assisting with a corporate sustainability due diligence assessment. Based strictly on the provided document excerpt, decide whether the document contains enough information to answer the question.
Return ONLY a compact JSON object with the following keys: "canAnswer" (boolean), "answerValue" (string or null), "answerLabel" (string), and "reason" (string).
- If "canAnswer" is true, "answerValue" must be one of [${question.options
    .map((option) => option.value)
    .join(', ')}] and "answerLabel" must match the chosen option's label.
- If "canAnswer" is false, set "answerValue" to null and "answerLabel" to an empty string. Explain briefly in "reason" why the document is insufficient.
Document name: ${
    documentState.name || 'Uploaded document'
  }
${truncatedNote ? `Note: ${truncatedNote}\n` : ''}Question: ${
    question.text
  }
Answer options:\n${optionsSummary}

Evidence excerpts:
${evidenceBlock}`;
}

function extractResponseText(responseData) {
  if (!responseData) {
    return '';
  }

  if (Array.isArray(responseData.output)) {
    return responseData.output
      .map((item) => {
        if (!item || !Array.isArray(item.content)) {
          return '';
        }
        return item.content
          .map((chunk) => {
            if (!chunk) {
              return '';
            }
            if (typeof chunk === 'string') {
              return chunk;
            }
            if (typeof chunk.text === 'string') {
              return chunk.text;
            }
            if (typeof chunk.value === 'string') {
              return chunk.value;
            }
            if (chunk.type === 'output_text' && typeof chunk.text === 'string') {
              return chunk.text;
            }
            return '';
          })
          .join('');
      })
      .join('');
  }

  if (Array.isArray(responseData.choices)) {
    return responseData.choices
      .map((choice) => {
        if (!choice) {
          return '';
        }
        if (typeof choice.text === 'string') {
          return choice.text;
        }
        if (choice.message) {
          const { message } = choice;
          if (Array.isArray(message.content)) {
            return message.content
              .map((part) => part.text || part.value || '')
              .join('');
          }
          if (typeof message.content === 'string') {
            return message.content;
          }
        }
        return '';
      })
      .join('');
  }

  return '';
}

function parseJsonFromText(text) {
  if (!text) {
    throw new Error('Empty AI response.');
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('AI response did not contain a JSON object.');
  }

  const jsonString = text.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString);
}

function resetAnswerSelect(select) {
  if (!select) {
    return;
  }
  select.value = '';
  const defaultOption = select.querySelector('option[value=""]');
  if (defaultOption) {
    defaultOption.selected = true;
  }
  select.dispatchEvent(new Event('change'));
}

function setStatusValue(select, value) {
  if (!select) {
    return;
  }
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

async function handleAiAssist(question, context) {
  const {
    button,
    statusEl,
    answerSelect,
    statusSelect,
    evidenceDocInput,
    reasoningTextarea,
  } = context;

  const apiKey = getApiKey();

  if (!apiKey) {
    setAiStatus(statusEl, 'error', 'Add your OpenAI API key first.');
    const apiInput = document.getElementById('api-key');
    if (apiInput) {
      apiInput.focus();
    }
    return;
  }

  if (!documentState.content) {
    setAiStatus(statusEl, 'error', 'Upload an evidence document before using the AI.');
    const uploadInput = document.getElementById('document-upload');
    if (uploadInput) {
      uploadInput.focus();
    }
    return;
  }

  let responseCallId = null;
  let rawResponseText = '';

  try {
    button.disabled = true;
    button.dataset.loading = 'true';

    const contextChunks = await gatherContextForQuestion(question, apiKey, statusEl);

    const consultingMessage = contextChunks.length
      ? 'Consulting the AI assistant…'
      : 'Consulting the AI assistant (no strong matches found)…';
    setAiStatus(statusEl, 'info', consultingMessage);

    const { data, callId } = await performOpenAiCall({
      endpoint: OPENAI_ENDPOINT,
      apiKey,
      payload: {
        model: OPENAI_MODEL,
        input: buildAiPrompt(question, contextChunks),
        temperature: 0.2,
      },
      meta: {
        type: 'responses',
        subtype: 'question-answer',
        description: `Question ${question.number || ''}`.trim(),
        questionNumber: question.number || '',
        questionText: question.text || '',
        contextChunks,
        previewExtractor: (responseData) => {
          const text = extractResponseText(responseData).trim();
          return text.length > 400 ? `${text.slice(0, 400)}…` : text;
        },
      },
    });

    responseCallId = callId;

    rawResponseText = extractResponseText(data).trim();
    const aiResult = parseJsonFromText(rawResponseText);

    const aiDecision = {
      canAnswer: Boolean(aiResult.canAnswer),
      answerValue: aiResult.answerValue || '',
      answerLabel: aiResult.answerLabel || '',
      reason: aiResult.reason || '',
    };

    const previewJson = JSON.stringify(aiResult, null, 2);
    const trimmedPreview =
      previewJson.length > 600 ? `${previewJson.slice(0, 600)}…` : previewJson;

    updateTelemetryEntry(callId, {
      responsePreview: trimmedPreview,
      aiDecision,
      errorMessage: '',
    });

    if (aiResult.canAnswer && aiResult.answerValue) {
      const validOption = question.options.find(
        (option) => option.value === aiResult.answerValue
      );

      if (validOption) {
        answerSelect.value = aiResult.answerValue;
        answerSelect.dispatchEvent(new Event('change'));
        setStatusValue(statusSelect, 'Answered by AI');
        setAiStatus(statusEl, 'success', 'Answer inserted by AI.');
      } else {
        setAiStatus(
          statusEl,
          'error',
          'AI returned an option that is not available for this question.'
        );
        return;
      }
    } else {
      resetAnswerSelect(answerSelect);
      setStatusValue(statusSelect, 'Open');
      const message =
        aiResult.reason || 'AI could not determine an answer from the document.';
      setAiStatus(statusEl, 'info', message);
    }

    if (aiResult.reason && reasoningTextarea) {
      reasoningTextarea.value = aiResult.reason;
    }

    if (documentState.name && evidenceDocInput && !evidenceDocInput.value) {
      evidenceDocInput.value = documentState.name;
    }

    updateMetrics();
  } catch (error) {
    console.error('AI assistance failed', error);
    setAiStatus(statusEl, 'error', error.message || 'AI request failed.');
    if (responseCallId) {
      const updates = {
        status: 'error',
        errorMessage: error.message || 'AI request failed.',
        aiDecision: null,
      };
      if (rawResponseText) {
        updates.responsePreview = rawResponseText;
      }
      updateTelemetryEntry(responseCallId, updates);
    }
  } finally {
    button.disabled = false;
    delete button.dataset.loading;
  }
}

function createSection(section, index) {
  const details = document.createElement('details');
  details.className = 'section';
  if (index === 0) {
    details.open = true;
  }

  const summary = document.createElement('summary');
  summary.className = 'section-summary';

  const heading = document.createElement('div');
  heading.className = 'section-heading';

  const title = document.createElement('span');
  title.className = 'section-title';
  title.textContent = section.title;

  const meta = document.createElement('span');
  meta.className = 'section-meta';
  meta.textContent = `${countQuestions(section)} questions`;

  heading.append(title, meta);

  summary.appendChild(heading);
  details.appendChild(summary);

  const content = document.createElement('div');

  if (section.questions) {
    section.questions.forEach((question) => {
      content.appendChild(createQuestionCard(question));
    });
  }

  if (section.subsections) {
    section.subsections.forEach((subsection) => {
      const subsectionHeading = document.createElement('h3');
      subsectionHeading.className = 'subsection-title';
      subsectionHeading.textContent = subsection.title;
      content.appendChild(subsectionHeading);

      subsection.questions.forEach((question) => {
        content.appendChild(createQuestionCard(question));
      });
    });
  }

  details.appendChild(content);

  return details;
}

function createQuestionCard(question) {
  const card = document.createElement('article');
  card.className = 'question-card';
  card.dataset.questionNumber = question.number;

  const header = document.createElement('div');
  header.className = 'question-header';

  const number = document.createElement('span');
  number.className = 'question-number';
  number.textContent = `Question ${question.number}`;

  const text = document.createElement('p');
  text.className = 'question-text';
  text.textContent = question.text;

  header.append(number, text);

  const fieldGrid = document.createElement('div');
  fieldGrid.className = 'field-grid';

  const answerField = document.createElement('div');
  const answerLabel = document.createElement('label');
  answerLabel.textContent = 'Answer';
  answerLabel.setAttribute('for', `answer-${question.number}`);

  const answerSelect = document.createElement('select');
  answerSelect.className = 'answer-select';
  answerSelect.id = `answer-${question.number}`;

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select answer';
  defaultOption.disabled = true;
  defaultOption.selected = true;
  answerSelect.appendChild(defaultOption);

  question.options.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    opt.dataset.score = option.score ?? 0;
    answerSelect.appendChild(opt);
  });

  answerSelect.addEventListener('change', () => {
    updateMetrics();
  });

  answerField.append(answerLabel, answerSelect);

  const statusField = document.createElement('div');
  const statusLabel = document.createElement('label');
  statusLabel.textContent = 'Status';
  statusLabel.setAttribute('for', `status-${question.number}`);

  const statusSelect = document.createElement('select');
  statusSelect.className = 'status-select';
  statusSelect.id = `status-${question.number}`;
  ['Open', 'Answered by AI', 'Checked'].forEach((status) => {
    const opt = document.createElement('option');
    opt.value = status;
    opt.textContent = status;
    statusSelect.appendChild(opt);
  });
  statusSelect.dataset.status = statusSelect.value;

  const statusIndicator = document.createElement('div');
  statusIndicator.className = 'status-indicator';
  const statusDot = document.createElement('span');
  statusDot.className = 'status-dot';
  const statusText = document.createElement('span');
  statusText.className = 'status-text';
  statusText.textContent = statusSelect.value;
  statusIndicator.append(statusDot, statusText);

  statusSelect.addEventListener('change', () => {
    statusSelect.dataset.status = statusSelect.value;
    statusText.textContent = statusSelect.value;
  });

  statusField.append(statusLabel, statusSelect, statusIndicator);

  const evidenceDocField = document.createElement('div');
  const evidenceDocLabel = document.createElement('label');
  evidenceDocLabel.textContent = 'Evidence document';
  evidenceDocLabel.setAttribute('for', `doc-${question.number}`);

  const evidenceDocInput = document.createElement('input');
  evidenceDocInput.type = 'text';
  evidenceDocInput.id = `doc-${question.number}`;
  evidenceDocInput.placeholder = 'Link or reference';

  evidenceDocField.append(evidenceDocLabel, evidenceDocInput);

  const reasoningField = document.createElement('div');
  reasoningField.className = 'full-span';
  const reasoningLabel = document.createElement('label');
  reasoningLabel.textContent = 'Evidence reasoning';
  reasoningLabel.setAttribute('for', `reasoning-${question.number}`);

  const reasoningTextarea = document.createElement('textarea');
  reasoningTextarea.id = `reasoning-${question.number}`;
  reasoningTextarea.placeholder = 'Add context or notes supporting the answer...';

  reasoningField.append(reasoningLabel, reasoningTextarea);

  const aiField = document.createElement('div');
  aiField.className = 'ai-actions full-span';

  const aiButton = document.createElement('button');
  aiButton.type = 'button';
  aiButton.className = 'ai-button';
  aiButton.textContent = 'Ask AI';

  const aiStatus = document.createElement('span');
  setAiStatus(aiStatus, '', 'Use the AI assistant to evaluate this question.');

  aiButton.addEventListener('click', () => {
    handleAiAssist(question, {
      button: aiButton,
      statusEl: aiStatus,
      answerSelect,
      statusSelect,
      evidenceDocInput,
      reasoningTextarea,
    });
  });

  aiField.append(aiButton, aiStatus);

  fieldGrid.append(
    answerField,
    statusField,
    evidenceDocField,
    reasoningField,
    aiField
  );

  card.append(header, fieldGrid);

  return card;
}

function countQuestions(section) {
  let total = 0;
  if (section.questions) {
    total += section.questions.length;
  }
  if (section.subsections) {
    section.subsections.forEach((subsection) => {
      total += subsection.questions.length;
    });
  }
  return total;
}

function updateMetrics() {
  const answerSelects = document.querySelectorAll('.answer-select');
  const totalQuestions = answerSelects.length;
  let answered = 0;
  let score = 0;

  answerSelects.forEach((select) => {
    if (select.value) {
      answered += 1;
      const selected = select.selectedOptions[0];
      const optionScore = Number(selected.dataset.score || 0);
      score += optionScore;
    }
  });

  const answeredEl = document.getElementById('answered-count');
  const scoreEl = document.getElementById('score-total');

  answeredEl.textContent = `${answered} / ${totalQuestions}`;
  scoreEl.textContent = score;
}

function init() {
  setupControlPanel();
  setupViewNavigation();
  updateAdminLog();
  switchAppView('questionnaire');
  const container = document.getElementById('questionnaire');
  questionnaireSections.forEach((section, index) => {
    container.appendChild(createSection(section, index));
  });
  updateMetrics();
}

window.addEventListener('DOMContentLoaded', init);
