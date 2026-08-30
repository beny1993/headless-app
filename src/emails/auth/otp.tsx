import { Button, Section, Text } from '@react-email/components';
import { EmailLayout } from '@/emails/components/email-layout';

type OtpEmailProps = {
  otp: string;
  magicUrl: string;
};

export function OtpEmail({ otp, magicUrl }: OtpEmailProps) {
  return (
    <EmailLayout preview={`Your sign-in code is ${otp}`}>
      <Text style={heading}>Sign in to the back office</Text>
      <Text style={paragraph}>
        Use this one-time code to sign in. It expires in 3 minutes.
      </Text>
      <Section style={codeBox}>
        <Text style={code}>{otp}</Text>
      </Section>
      <Text style={paragraph}>Or sign in with one click:</Text>
      <Button href={magicUrl} style={button}>
        Sign in
      </Button>
      <Text style={muted}>
        If you didn&apos;t request this code, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
}

// Preview props for `pnpm dev:email`
OtpEmail.PreviewProps = {
  otp: '123456',
  magicUrl: 'http://localhost:3000/auth/magic?email=you@example.com&otp=123456',
} satisfies OtpEmailProps;

export default OtpEmail;

const heading = {
  color: '#171717',
  fontSize: '20px',
  fontWeight: 600 as const,
  margin: '0 0 8px',
};

const paragraph = {
  color: '#404040',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 16px',
};

const codeBox = {
  backgroundColor: '#f6f6f6',
  borderRadius: '8px',
  margin: '0 0 16px',
  padding: '12px 0',
  textAlign: 'center' as const,
};

const code = {
  color: '#171717',
  fontSize: '28px',
  fontWeight: 700 as const,
  letterSpacing: '6px',
  margin: 0,
};

const button = {
  backgroundColor: '#171717',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 600 as const,
  margin: '0 0 16px',
  padding: '10px 20px',
  textDecoration: 'none',
};

const muted = {
  color: '#8a8a8a',
  fontSize: '12px',
  lineHeight: '18px',
  margin: 0,
};
