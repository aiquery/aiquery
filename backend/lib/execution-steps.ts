/**
 * Live and persisted “what Kira did” steps for a data query turn.
 * Shared by POST /api/chat (response + DB) and the Chat UI (import via Vite alias @shared).
 */
export interface ExecutionStep {
  id: string;
  title: string;
  detail: string;
}

export function buildExecutionSteps(question: string): ExecutionStep[] {
  const preview =
    question.length > 120 ? `${question.slice(0, 120)}…` : question.trim() || '(your question)';
  return [
    {
      id: 'plan',
      title: 'Understanding your goal',
      detail: `Read your message and identified what you are asking for. Focus text: "${preview}".`,
    },
    {
      id: 'prepare',
      title: 'Gathering context',
      detail:
        'Loaded your connection settings, checked permissions, and retrieved Knowledge Base snippets (schemas, table/column notes, business terms) so the query matches how your data is actually modeled.',
    },
    {
      id: 'sql',
      title: 'Drafting and checking SQL',
      detail:
        'Asked the model to generate SQL against your connected source, then ran safety checks (syntax, allowed operations, and alignment with the retrieved schema context) before execution.',
    },
    {
      id: 'execute',
      title: 'Running the query',
      detail:
        'Executed the statement on your data source, waited for rows, and captured row count and sample values for interpretation (timeouts and engine errors surface here).',
    },
    {
      id: 'respond',
      title: 'Summarizing results',
      detail:
        'When rows are returned, turned them into a concise answer with highlights and caveats. Refinement chips appear only after a real query result.',
    },
  ];
}
