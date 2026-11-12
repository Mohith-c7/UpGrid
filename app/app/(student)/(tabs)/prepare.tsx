import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, Icon, ProgressBar, Text } from '@/ui';
import { colors, MIN_TOUCH } from '@/theme';
import { Page, sp } from '@/features/student/me/kit';
import { TestsHomeCard } from '@/features/tests/TestsHomeCard';

/**
 * Static, hand-written guidance. No fake data, no external links, nothing fetched.
 * Ticks are kept only while the app is open (no storage), which the screen says plainly.
 */
interface Section { key: string; title: string; intro: string; items: string[] }
const SECTIONS: Section[] = [
  {
    key: 'resume', title: 'Resume basics',
    intro: 'Recruiters skim. Make the first half page count.',
    items: [
      'Keep it to one page unless you have strong, relevant experience',
      'Put education first: degree, department, batch year and CGPA that match your Placement OS profile',
      'Use the same name and contact details as your profile so there is nothing to explain',
      'List projects with what you built, the tools used and one measurable result',
      'Use plain headings and a standard font; avoid photos, tables and graphics',
      'Check every spelling, date and link; open each link in a private window',
      'Upload the file as a PDF or Word document in Profile, Resumes, or share it by https link (for example a view-only link from your drive)',
      'Set the link to "anyone with the link can view" and test it while logged out',
    ],
  },
  {
    key: 'aptitude', title: 'Aptitude practice',
    intro: 'Most first rounds test speed and accuracy on basics.',
    items: [
      'Revise percentages, ratios, averages, time and work, and simple probability',
      'Practise number series and basic logical reasoning with a timer',
      'Read short passages and answer within a set time to build comprehension speed',
      'Learn which sections have negative marking and skip rather than guess when it applies',
      'Review mistakes after every practice set and note the pattern, not just the answer',
      'Do at least one full timed set before a real assessment',
    ],
  },
  {
    key: 'interview', title: 'Interview preparation',
    intro: 'Prepare a few stories and know your own resume well.',
    items: [
      'Prepare a 60-second introduction: who you are, what you studied, what you built, what role you want',
      'Be ready to explain every project and skill on your resume in detail',
      'Revise core subjects for your department; interviewers start from your syllabus',
      'Prepare two or three examples of teamwork, a mistake you learned from, and a challenge you solved',
      'Research the company and the role from its official site before the interview',
      'Prepare a few questions to ask the interviewer',
      'Test your camera, microphone and internet at least an hour before an online interview',
      'Keep your ID and a copy of your resume ready',
    ],
  },
  {
    key: 'eligibility', title: 'How eligibility works here',
    intro: 'Each drive sets its own rules. The app compares them with your profile.',
    items: [
      'Rules can include minimum CGPA, 10th and 12th percentage, active backlogs, gap years, department and batch',
      'Eligible: every rule is met. Not eligible: at least one rule is not met. Pending: a rule cannot be checked because a profile value is missing',
      'Fill your academic details completely to move drives from pending to eligible or not eligible',
      'Editing a verified academic field resets it to unverified until the placement cell checks it again',
      'Placement OS does not read data from any university system. Your details come from you, and the placement cell verifies them manually',
      'The placement cell makes the final call. If something looks wrong, contact them with your registration number',
    ],
  },
];

export default function PrepareTab() {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>('resume');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setDone((d) => ({ ...d, [k]: !d[k] }));

  return (
    <Page title="Prepare">
      <TestsHomeCard />
      <Banner tone="info" message="General guidance for first-time applicants, not tailored to any company. Ticks reset when you close the app." />
      {SECTIONS.map((s) => {
        const isOpen = open === s.key;
        const n = s.items.filter((_, i) => done[`${s.key}:${i}`]).length;
        return (
          <Card key={s.key} padding={0}>
            <Pressable
              onPress={() => setOpen(isOpen ? null : s.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${s.title}, ${n} of ${s.items.length} done`}
              style={({ pressed }) => ({ minHeight: MIN_TOUCH + 16, padding: sp.lg, gap: sp.sm, borderRadius: 14, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="subhead">{s.title}</Text>
                  <Text variant="caption" color={colors.muted} tabular>{`${n} of ${s.items.length} done`}</Text>
                </View>
                <Icon name={isOpen ? 'expand-less' : 'expand-more'} size={24} color={colors.muted} />
              </View>
              <ProgressBar value={s.items.length ? n / s.items.length : 0} label={`${s.title} progress`} />
            </Pressable>
            {isOpen ? (
              <View style={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text variant="body" color={colors.muted} style={{ paddingVertical: sp.md }}>{s.intro}</Text>
                {s.items.map((it, i) => {
                  const k = `${s.key}:${i}`;
                  const on = !!done[k];
                  return (
                    <Pressable
                      key={k}
                      onPress={() => toggle(k)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={it}
                      style={({ pressed }) => ({ minHeight: MIN_TOUCH, flexDirection: 'row', gap: sp.md, alignItems: 'center', paddingVertical: sp.xs, backgroundColor: pressed ? colors.pressed : 'transparent' })}
                    >
                      <Icon name={on ? 'check-box' : 'check-box-outline-blank'} size={24} color={on ? colors.primary : colors.muted} />
                      <Text variant="body" style={{ flex: 1, minWidth: 0 }} color={on ? colors.muted : colors.ink}>{it}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </Card>
        );
      })}
      <Card onPress={() => router.push('/(student)/prep' as never)} accessibilityLabel="Open the prep hub">
        <View style={{ gap: sp.xs }}>
          <Text variant="subhead">Prep hub</Text>
          <Text variant="body" color={colors.textSecondary}>Practice problems, mock interviews, resume builder and upcoming tests.</Text>
        </View>
      </Card>
      <Card tinted>
        <View style={{ gap: sp.md }}>
          <Text variant="subhead">Check where you stand</Text>
          <Text variant="body" color={colors.textSecondary}>See which drives you can apply to and what is missing for the rest.</Text>
          <Button label="Open eligibility" full onPress={() => router.push('/(student)/eligibility' as never)} />
        </View>
      </Card>
    </Page>
  );
}
