import React from 'react';
import { View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { Banner, Button, Card, Text } from '@/ui';
import { Page } from '../student/me/kit';

type Doc = 'terms' | 'privacy';

const BANNER = 'Draft — replace with a lawyer-reviewed policy before launch (DPDP Act)';

interface Section { title: string; body: string[] }

const TERMS: Section[] = [
  {
    title: 'Using Placement OS',
    body: [
      'Placement OS is run by your institution\'s placement cell to publish campus drives, collect your applications and share updates.',
      'You must give accurate details. Marks, backlogs and links you enter may be checked against college records. Wrong or misleading details can lead to your application being rejected.',
    ],
  },
  {
    title: 'Your account',
    body: [
      'Keep your password private. You are responsible for activity on your account.',
      'You can delete your account at any time from Profile, Account, Delete account.',
    ],
  },
  {
    title: 'Applications and offers',
    body: [
      'Applying to a drive is your choice. The placement cell records status changes. Company decisions reach you through the placement cell.',
      'Accepting or declining an offer in the app is recorded and cannot be changed in the app afterwards.',
    ],
  },
  {
    title: 'Acceptable use',
    body: [
      'Do not upload unlawful content, impersonate others, or try to access data that is not yours.',
      'The placement cell may suspend accounts that break these rules.',
    ],
  },
];

const PRIVACY: Section[] = [
  {
    title: 'What data we collect',
    body: [
      'Profile: name, registration number, preferred name, city and state, skills and preferences.',
      'Academics: department, program, batch year, semester, CGPA, 10th and 12th percentages, active backlogs and gap years.',
      'Resumes: the links you add and any PDF or Word files you upload.',
      'Contact: email address and mobile number.',
      'Device token: a push notification token for your phone, so we can send deadline and status alerts.',
    ],
  },
  {
    title: 'Who can see it',
    body: [
      'The placement cell can see your profile, academics, links and applications so it can verify details and run drives.',
      'Companies see your data only for drives you choose to apply to, and only the fields shown to you on the apply screen at the time you apply.',
      'We do not sell your data.',
    ],
  },
  {
    title: 'How long we keep it',
    body: [
      'We keep your data while your account is active. [Retention period to be confirmed by counsel.]',
      'You can delete your account in the app (Profile, Account, Delete account). This signs you out everywhere, removes your device tokens and closes your account. The placement cell may keep application records it has already received. [Exact retention to be confirmed by counsel.]',
    ],
  },
  {
    title: 'Your choices',
    body: [
      'You can correct your details in Profile, turn reminders off in Reminders, and raise a request through Help & support.',
      '[Grievance officer contact and DPDP Act rights wording to be added by counsel.]',
    ],
  },
];

export default function LegalScreen({ doc }: { doc: Doc }) {
  const router = useRouter();
  const segments = useSegments() as unknown as string[];
  const group = segments[0] === '(auth)' ? '(auth)' : segments[0] === '(officer)' ? '(officer)' : segments[0] === '(recruiter)' ? '(recruiter)' : '(student)';
  const base = group === '(auth)' ? '/(auth)' : group === '(officer)' ? '/(officer)/legal' : group === '(recruiter)' ? '/(recruiter)/legal' : '/(student)/settings';
  const fallback = group === '(auth)' ? '/(auth)/register' : group === '(officer)' ? '/(officer)/(tabs)/more' : group === '(recruiter)' ? '/(recruiter)/(tabs)/profile' : '/(student)/settings/account';
  const sections = doc === 'terms' ? TERMS : PRIVACY;
  const other: Doc = doc === 'terms' ? 'privacy' : 'terms';

  return (
    <Page
      title={doc === 'terms' ? 'Terms of use' : 'Privacy policy'}
      onBack={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
    >
      <Banner tone="warning" title="Draft" message={BANNER} />
      {sections.map((s) => (
        <Card key={s.title}>
          <View style={{ gap: 8 }}>
            <Text variant="subhead" accessibilityRole="header">{s.title}</Text>
            {s.body.map((b, i) => <Text key={i} variant="body">{b}</Text>)}
          </View>
        </Card>
      ))}
      <Button
        label={other === 'privacy' ? 'Read the Privacy policy' : 'Read the Terms of use'}
        variant="secondary"
        full
        onPress={() => router.push(`${base}/${other}` as never)}
      />
    </Page>
  );
}
