import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, CodeBlock, Text, useToast } from '@/ui';
import { colors } from '@/theme';
import { errMessage } from '@/api/client';
import { validateConditions } from '@/api/ops';
import type { ValidateConditionsResult } from '@/api/opsTypes';
import { ConditionEditor, countNodes, depthOf, localProblems, newGroup, toCondition, MAX_DEPTH, MAX_NODES } from '@/features/ops/ConditionEditor';
import { Group, OpsPage, useOnce, useShareFile } from '@/features/ops/kit';

export default function ConditionBuilder() {
  const toast = useToast();
  const share = useShareFile();
  const [root, setRoot] = useState(() => newGroup('all'));
  const [result, setResult] = useState<ValidateConditionsResult | null>(null);
  const [local, setLocal] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [check, busy] = useOnce(async () => {
    setErr(null); setResult(null);
    const problems = localProblems(root);
    setLocal(problems);
    if (problems.length) return;
    try { setResult(await validateConditions(toCondition(root))); } catch (e) { setErr(errMessage(e)); }
  });
  const json = JSON.stringify(toCondition(root), null, 2);
  const [doShare] = useOnce(async () => { await share(async () => json, 'drive-conditions.json', 'application/json', 'Condition JSON'); });
  const edit = (n: typeof root) => { setRoot(n); setResult(null); setLocal([]); };

  return (
    <OpsPage title="Condition builder" back="/(officer)/ops/policy" footer={<Button label="Check conditions" icon="rule" full loading={busy} onPress={() => check()} />}>
      <Text variant="body" color={colors.textSecondary}>Build extra eligibility conditions for a drive. Missing student data counts as unknown, so the student shows as pending instead of failing.</Text>
      <Text variant="caption" color={colors.muted}>Up to {MAX_DEPTH} levels and {MAX_NODES} conditions. Used now: {countNodes(root)} conditions, {depthOf(root)} levels.</Text>
      <Group><ConditionEditor root={root} onChange={edit} /></Group>
      {local.length ? <Banner tone="error" title="Fix these first" message={local.join('\n')} /> : null}
      {err ? <Banner tone="error" message={err} /> : null}
      {result ? (result.valid ? <Banner tone="success" message="The server accepts these conditions." /> : <Banner tone="error" title="The server rejected these" message={result.errors.map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join('\n')} />) : null}
      <View style={{ gap: 12 }}>
        <CodeBlock label="Condition JSON" code={json} />
        <Button label="Share JSON" icon="ios-share" variant="secondary" full onPress={() => doShare()} />
        <Text variant="caption" color={colors.muted}>Paste this into a drive's extra rules (PUT /drives/:id, rules.extra). The drive editor does not embed this builder yet.</Text>
      </View>
    </OpsPage>
  );
}
