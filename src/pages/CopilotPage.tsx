import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { Bot, ChevronDown, ChevronRight, Database, Send } from 'lucide-react';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  intent?: string;
  sql?: string;
  evidence?: Array<Record<string, unknown>>;
  rephrasedByGemini?: boolean;
}

const SUGGESTED_QUESTIONS = [
  'Which trains are currently delayed?',
  'Which section is the most congested bottleneck?',
  'Why is train G-501 delayed?',
  'How much delay and throughput improved after optimization?',
  'List active critical conflicts right now.',
  'What happens if train 12127 is delayed by 20 minutes?',
  'Which trains violate headway or single-line rules?',
  'Which platform has the highest load at DD?',
  'What weather protocol is currently active?',
  'Which track sections need predictive maintenance?',
  'How much traction energy and CO2 is saved?',
  'How many more trains can the single-line corridor handle?',
];

export function CopilotPage() {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Railway Operations Copilot ready. Every answer executes deterministic SQL queries or optimization/propagation tools against the live corridor database with verifiable evidence tables.',
      intent: 'SYSTEM_READY',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedSql, setExpandedSql] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiFetch<Array<{ id: number; question: string; intent: string; sql_used: string; answer: string }>>('/copilot/history')
      .then((hist) => {
        if (hist.length > 0 && messages.length === 1) {
          // keep welcome clean; history accessible
        }
      })
      .catch(() => {});
  }, []);

  const ask = async (qText: string) => {
    const q = qText.trim();
    if (!q || loading) return;
    const userMsg: CopilotMessage = { id: `u_${Date.now()}`, role: 'user', text: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await apiFetch<{
        intent: string;
        sql_or_tool_used: string;
        answer: string;
        evidence: Array<Record<string, unknown>>;
        rephrased_by_gemini: boolean;
      }>('/copilot/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: res.answer,
          intent: res.intent,
          sql: res.sql_or_tool_used,
          evidence: res.evidence,
          rephrasedByGemini: res.rephrased_by_gemini,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          role: 'assistant',
          text: e instanceof Error ? e.message : 'Copilot query failed.',
          intent: 'ERROR',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Railway AI Copilot (Grounded SQL + Operations Tools)</h2>
        <p className="text-xs text-slate-400">
          25+ deterministic railway intents backed by whitelisted SQLite queries, blast-radius propagation, and verification evidence.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-lg bg-[#102442] border border-slate-700/60 flex flex-col h-[600px]">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[90%] rounded-lg p-3.5 text-xs space-y-2 ${
                    m.role === 'user'
                      ? 'bg-sky-600/25 border border-sky-500/40 text-slate-100'
                      : 'bg-[#0B1B33] border border-slate-700/70 text-slate-200'
                  }`}
                >
                  {m.role === 'assistant' && (
                    <div className="flex items-center gap-2 text-[11px] font-mono text-sky-400">
                      <Bot className="w-3.5 h-3.5" />
                      <span>{m.intent ?? 'COPILOT'}</span>
                      {m.rephrasedByGemini && <span className="text-slate-400">· Gemini Formatted</span>}
                    </div>
                  )}
                  <div className="leading-relaxed whitespace-pre-wrap">{m.text}</div>

                  {m.sql && (
                    <div className="pt-1 border-t border-slate-800">
                      <button
                        onClick={() => setExpandedSql((p) => ({ ...p, [m.id]: !p[m.id] }))}
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-slate-200"
                      >
                        {expandedSql[m.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <Database className="w-3 h-3" />
                        Show SQL & Evidence ({m.evidence?.length ?? 0} rows)
                      </button>

                      {expandedSql[m.id] && (
                        <div className="mt-2 space-y-2">
                          <pre className="p-2 rounded bg-[#071224] text-[10px] font-mono text-emerald-300 overflow-x-auto">{m.sql}</pre>
                          {m.evidence && m.evidence.length > 0 && (
                            <div className="overflow-x-auto max-h-48">
                              <table className="w-full text-[11px] font-mono">
                                <thead>
                                  <tr className="text-slate-400 border-b border-slate-800">
                                    {Object.keys(m.evidence[0]).map((k) => (
                                      <th key={k} className="py-1 px-2 text-left">
                                        {k}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60">
                                  {m.evidence.slice(0, 10).map((row, idx) => (
                                    <tr key={idx}>
                                      {Object.keys(m.evidence![0]).map((k) => (
                                        <td key={k} className="py-1 px-2 text-slate-300">
                                          {String(row[k] ?? '')}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div className="text-xs font-mono text-sky-400">Querying database & analytical tools...</div>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="p-3 border-t border-slate-700/60 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about delays, bottlenecks, train 12127 blast radius, platforms, capacity..."
              className="flex-1 rounded-lg bg-[#0B1B33] border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" /> Ask
            </button>
          </form>
        </div>

        <div className="rounded-lg bg-[#102442] border border-slate-700/60 p-4 space-y-3 h-[600px] overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-100">Controller Quick Queries</h3>
          <p className="text-[11px] text-slate-400">Click any operational question to execute immediately:</p>
          <div className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="w-full text-left rounded-lg bg-[#0B1B33] hover:bg-[#162F54] border border-slate-700/60 px-3 py-2 text-xs text-slate-200 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
