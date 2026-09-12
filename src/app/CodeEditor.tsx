import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { linter, forceLinting, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import type { Diagnostic } from '../ir/types';
import { editorBridge } from './bridge';

const KEYWORDS = [
  'participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue',
  'class', 'abstract', 'interface', 'enum', 'annotation', 'namespace', 'package', 'state',
  'component', 'cloud', 'node', 'folder', 'frame', 'storage', 'usecase', 'rectangle',
  'start', 'stop', 'end', 'endif', 'endwhile', 'endwhile', 'if', 'else', 'elseif', 'then',
  'while', 'repeat', 'fork', 'again', 'merge', 'partition', 'switch', 'case',
  'alt', 'opt', 'loop', 'par', 'critical', 'group', 'break', 'ref', 'note', 'over',
  'title', 'header', 'footer', 'activate', 'deactivate', 'destroy', 'autonumber',
  'flowchart', 'graph', 'subgraph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'erDiagram', 'mindmap', 'gantt', 'journey', 'pie', 'timeline', 'gitGraph', 'C4Context',
  'hide', 'skinparam', 'left', 'right', 'top', 'bottom', 'direction', 'as', 'is',
];

const ARROWS = [
  '->>', '-->>', '<<--', '<--', '-->', '->x', '->o', 'o->', '->', '<-', '-\\',
  '--|>', '..|>', '--*>', '--o>', '..o>', '-->', '..>', '--*', '--o', '--', '..',
];

interface DslState { inBlock: boolean }

const dsl = StreamLanguage.define<DslState>({
  name: 'ds-dsl',
  startState: () => ({ inBlock: false }),
  token(stream, state) {
    if (state.inBlock) {
      if (stream.skipTo("'/")) { stream.match("'/"); state.inBlock = false; }
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match("^/'")) { state.inBlock = true; return 'comment'; }
    if (stream.match(/^'.*/) || stream.match(/^%%.*/) || stream.match(/^\/\/.*/)) return 'comment';
    if (stream.match(/^"[^"]*"/)) return 'string';
    if (stream.match(new RegExp(`^(${KEYWORDS.join('|')})\\b`))) return 'keyword';
    if (stream.match(new RegExp(`^(${ARROWS.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`))) return 'operator';
    if (stream.match(/^@\w+/)) return 'keyword';
    if (stream.match(/^<<[^>]*>>/)) return 'string';
    if (stream.match(/^\d+/)) return 'number';
    stream.next();
    return null;
  },
  tokenTable: {
    keyword: tags.keyword,
    comment: tags.comment,
    string: tags.string,
    operator: tags.operator,
    number: tags.number,
  },
  languageData: { commentTokens: { line: "'" } },
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#7c3aed', fontWeight: '600' },
  { tag: tags.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: tags.string, color: '#0f766e' },
  { tag: tags.operator, color: '#b45309', fontWeight: '600' },
  { tag: tags.number, color: '#b45309' },
]);

const cmTheme = (dark: boolean) =>
  EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: '13.5px',
        backgroundColor: dark ? '#0f172a' : '#ffffff',
        color: dark ? '#e2e8f0' : '#1f2937',
      },
      '.cm-content': { fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'PingFang SC', monospace", padding: '10px 0' },
      '.cm-gutters': {
        backgroundColor: dark ? '#0f172a' : '#fbfcfe',
        color: dark ? '#64748b' : '#94a3b8',
        border: 'none',
        borderRight: `1px solid ${dark ? '#1e293b' : '#eef2f7'}`,
      },
      '.cm-activeLine': { backgroundColor: dark ? '#16213a' : '#f6f9fe' },
      '.cm-activeLineGutter': { backgroundColor: dark ? '#16213a' : '#f6f9fe' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: dark ? '#1e3a5f' : '#dbeafe' },
      '&.cm-focused .cm-cursor': { borderLeftColor: '#2563eb', borderLeftWidth: '2px' },
      '.cm-lint-marker-error': { content: 'none' },
    },
    { dark }
  );

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  diagnostics: Diagnostic[];
  dark: boolean;
  onCursor?: (pos: number) => void;
}

export function CodeEditor({ value, onChange, diagnostics, dark, onCursor }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const diagRef = useRef<Diagnostic[]>(diagnostics);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const themeComp = useRef(new Compartment());

  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;

  useEffect(() => {
    diagRef.current = diagnostics;
    const v = viewRef.current;
    if (v) forceLinting(v);
  }, [diagnostics]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const lintExt = linter(
      (view) => {
        const len = view.state.doc.length;
        const out: CmDiagnostic[] = [];
        for (const d of diagRef.current) {
          const from = Math.max(0, Math.min(d.span?.start ?? 0, len));
          const to = Math.max(from, Math.min(d.span?.end ?? from + 1, len));
          if (to <= from && from >= len) continue;
          out.push({
            from,
            to: to > from ? to : Math.min(len, from + 1),
            severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
            message: d.message,
          });
        }
        return out;
      },
      { delay: 250 }
    );

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          EditorState.allowMultipleSelections.of(true),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          dsl,
          syntaxHighlighting(highlight),
          lintExt,
          themeComp.current.of(cmTheme(dark)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.selectionSet) onCursorRef.current?.(u.state.selection.main.head);
          }),
        ],
      }),
    });

    viewRef.current = view;
    editorBridge.selectRange = (from, to, opts) => {
      // 调用方可能持有「上一次源码」的偏移量（画布刚提交补丁、编辑器还没同步），必须钳制
      const len = view.state.doc.length;
      const a = Math.max(0, Math.min(from, len));
      const b = Math.max(a, Math.min(to, len));
      view.dispatch({
        selection: { anchor: a, head: b },
        effects: [EditorView.scrollIntoView(a, { y: 'center' })],
      });
      if (opts?.focus !== false) view.focus();
    };

    return () => {
      editorBridge.selectRange = undefined;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部切换文档时同步内容
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({ effects: themeComp.current.reconfigure(cmTheme(dark)) });
  }, [dark]);

  return <div className="editor-host" ref={hostRef} />;
}
