/**
 * Nested eligibility-condition editor: simple rows with indentation, no drag and drop.
 * Produces the `{field,op,value}` / `{all}` / `{any}` / `{not}` tree used by a drive's `rules.extra`.
 */
import React from 'react';
import { View } from 'react-native';
import { Button, Select, SegmentedControl, Text, TextField } from '@/ui';
import { colors } from '@/theme';
import type { Condition } from '@/api/opsTypes';

export type Node =
  | { id: string; kind: 'leaf'; field: string; op: string; value: string }
  | { id: string; kind: 'group'; mode: 'all' | 'any'; children: Node[] }
  | { id: string; kind: 'not'; child: Node };

type FieldType = 'number' | 'text' | 'bool' | 'list';
export const FIELDS: { value: string; label: string; type: FieldType }[] = [
  { value: 'cgpa', label: 'CGPA (10 scale)', type: 'number' }, { value: 'tenthPercent', label: '10th percent', type: 'number' },
  { value: 'twelfthPercent', label: '12th percent', type: 'number' }, { value: 'activeBacklogs', label: 'Active backlogs', type: 'number' },
  { value: 'gapYears', label: 'Gap years', type: 'number' }, { value: 'semester', label: 'Semester', type: 'number' },
  { value: 'batchYear', label: 'Batch year', type: 'number' }, { value: 'department', label: 'Department', type: 'text' },
  { value: 'program', label: 'Program', type: 'text' }, { value: 'city', label: 'City', type: 'text' }, { value: 'state', label: 'State', type: 'text' },
  { value: 'skills', label: 'Skills', type: 'list' }, { value: 'hasAcceptedOffer', label: 'Has accepted offer', type: 'bool' },
  { value: 'acceptedOfferLpa', label: 'Accepted offer (LPA)', type: 'number' }, { value: 'academicsVerified', label: 'Academics verified', type: 'bool' },
];
const OPS: { value: string; label: string }[] = [
  { value: 'eq', label: 'is' }, { value: 'neq', label: 'is not' }, { value: 'gt', label: 'greater than' }, { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'less than' }, { value: 'lte', label: 'at most' }, { value: 'between', label: 'between (a, b)' },
  { value: 'in', label: 'is one of (a, b, c)' }, { value: 'nin', label: 'is none of (a, b, c)' }, { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'has a value' }, { value: 'notExists', label: 'has no value' },
];
const OPS_BY_TYPE: Record<FieldType, string[]> = {
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'nin', 'exists', 'notExists'],
  text: ['eq', 'neq', 'in', 'nin', 'contains', 'exists', 'notExists'],
  bool: ['eq', 'neq', 'exists', 'notExists'],
  list: ['contains', 'in', 'nin', 'exists', 'notExists'],
};
export const MAX_DEPTH = 6;
export const MAX_NODES = 50;

let seq = 0;
const nid = () => `n${++seq}`;
export const newLeaf = (): Node => ({ id: nid(), kind: 'leaf', field: 'cgpa', op: 'gte', value: '' });
export const newGroup = (mode: 'all' | 'any' = 'all'): Node => ({ id: nid(), kind: 'group', mode, children: [newLeaf()] });
export const newNot = (): Node => ({ id: nid(), kind: 'not', child: newLeaf() });

export const countNodes = (n: Node): number => (n.kind === 'leaf' ? 1 : n.kind === 'not' ? 1 + countNodes(n.child) : 1 + n.children.reduce((a, c) => a + countNodes(c), 0));
export const depthOf = (n: Node): number => (n.kind === 'leaf' ? 1 : n.kind === 'not' ? 1 + depthOf(n.child) : 1 + Math.max(0, ...n.children.map(depthOf)));

const typeOf = (field: string): FieldType => FIELDS.find((f) => f.value === field)?.type ?? 'text';
const needsValue = (op: string) => op !== 'exists' && op !== 'notExists';
function parseScalar(raw: string, t: FieldType): unknown {
  const s = raw.trim();
  if (t === 'number') return Number(s);
  if (t === 'bool') return s === 'true';
  return s;
}

/** Local problems the server would also reject; returns messages with the leaf label. */
export function localProblems(n: Node, path = 'Condition'): string[] {
  if (n.kind === 'leaf') {
    if (!needsValue(n.op)) return [];
    const t = typeOf(n.field);
    const parts = n.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (t !== 'bool' && parts.length === 0) return [`${path}: enter a value`];
    if (n.op === 'between' && parts.length !== 2) return [`${path}: "between" needs two values like 6, 8`];
    if (t === 'number' && parts.some((p) => !Number.isFinite(Number(p)))) return [`${path}: numbers only`];
    return [];
  }
  if (n.kind === 'not') return localProblems(n.child, `${path} › not`);
  if (n.children.length === 0) return [`${path}: add at least one condition`];
  return n.children.flatMap((c, i) => localProblems(c, `${path} › ${i + 1}`));
}

export function toCondition(n: Node): Condition {
  if (n.kind === 'not') return { not: toCondition(n.child) };
  if (n.kind === 'group') return n.mode === 'all' ? { all: n.children.map(toCondition) } : { any: n.children.map(toCondition) };
  const t = typeOf(n.field);
  if (!needsValue(n.op)) return { field: n.field, op: n.op };
  const parts = n.value.split(',').map((x) => x.trim()).filter(Boolean);
  if (n.op === 'in' || n.op === 'nin' || n.op === 'between') return { field: n.field, op: n.op, value: parts.map((p) => parseScalar(p, t)) };
  return { field: n.field, op: n.op, value: parseScalar(n.value, t) };
}

function mapNode(n: Node, id: string, fn: (x: Node) => Node | null): Node | null {
  if (n.id === id) return fn(n);
  if (n.kind === 'leaf') return n;
  if (n.kind === 'not') { const c = mapNode(n.child, id, fn); return c ? { ...n, child: c } : null; }
  return { ...n, children: n.children.map((c) => mapNode(c, id, fn)).filter((c): c is Node => !!c) };
}

export function ConditionEditor({ root, onChange }: { root: Node; onChange: (n: Node) => void }) {
  const total = countNodes(root);
  const update = (id: string, fn: (x: Node) => Node | null) => { const r = mapNode(root, id, fn); if (r) onChange(r); };
  return <NodeView n={root} depth={1} isRoot total={total} update={update} />;
}

function NodeView({ n, depth, isRoot, total, update }: { n: Node; depth: number; isRoot?: boolean; total: number; update: (id: string, fn: (x: Node) => Node | null) => void }) {
  const canAdd = total < MAX_NODES;
  const canNest = depth < MAX_DEPTH && total < MAX_NODES;
  const indent = { borderLeftWidth: 2, borderLeftColor: colors.primaryTint2, paddingLeft: 12, gap: 12 };
  const remove = !isRoot ? <Button label="Remove" icon="delete-outline" variant="ghost" size="sm" onPress={() => update(n.id, () => null)} /> : null;

  if (n.kind === 'leaf') {
    const t = typeOf(n.field);
    const opts = OPS.filter((o) => OPS_BY_TYPE[t].includes(o.value));
    return (
      <View style={{ gap: 12, padding: 12, backgroundColor: colors.surfaceAlt, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
        <Select label="Field" value={n.field} onChange={(v) => update(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'leaf' }>), field: v, op: OPS_BY_TYPE[typeOf(v)].includes((x as any).op) ? (x as any).op : OPS_BY_TYPE[typeOf(v)][0], value: '' }))} options={FIELDS} />
        <Select label="Condition" value={n.op} onChange={(v) => update(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'leaf' }>), op: v }))} options={opts} />
        {needsValue(n.op) ? (t === 'bool' ? (
          <SegmentedControl value={n.value === 'true' ? 'true' : 'false'} onChange={(v) => update(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'leaf' }>), value: v }))} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
        ) : (
          <TextField label={n.op === 'between' || n.op === 'in' || n.op === 'nin' ? 'Values, separated by commas' : 'Value'} value={n.value} onChangeText={(v) => update(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'leaf' }>), value: v }))}
            keyboardType={t === 'number' ? 'numbers-and-punctuation' : 'default'} maxLength={120} />
        )) : null}
        {remove}
      </View>
    );
  }

  if (n.kind === 'not') {
    return (
      <View style={indent}>
        <Text variant="subhead">Not (the condition below must be false)</Text>
        <NodeView n={n.child} depth={depth + 1} total={total} update={update} />
        {remove}
      </View>
    );
  }

  return (
    <View style={indent}>
      <SegmentedControl value={n.mode} onChange={(v) => update(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'group' }>), mode: v as 'all' | 'any' }))}
        options={[{ value: 'all', label: 'All must match' }, { value: 'any', label: 'Any can match' }]} />
      {n.children.map((c) => <NodeView key={c.id} n={c} depth={depth + 1} total={total} update={update} />)}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label="Condition" icon="add" size="sm" variant="secondary" disabled={!canAdd} onPress={() => update(n.id, (x) => ({ ...(x as any), children: [...(x as any).children, newLeaf()] }))} />
        <Button label="Group" icon="add" size="sm" variant="secondary" disabled={!canNest} onPress={() => update(n.id, (x) => ({ ...(x as any), children: [...(x as any).children, newGroup('any')] }))} />
        <Button label="Not" icon="add" size="sm" variant="secondary" disabled={!canNest} onPress={() => update(n.id, (x) => ({ ...(x as any), children: [...(x as any).children, newNot()] }))} />
      </View>
      {!canAdd ? <Text variant="caption" color={colors.warning}>Limit reached: {MAX_NODES} conditions.</Text> : null}
      {remove}
    </View>
  );
}
