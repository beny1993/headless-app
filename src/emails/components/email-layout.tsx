import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { ReactNode } from 'react';
import { DEFAULT_SITE_NAME } from '@/constants';

type EmailLayoutProps = {
  preview: string;
  children: ReactNode;
};

export function EmailLayout({ preview, children }: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section>
            <Text style={brand}>{DEFAULT_SITE_NAME}</Text>
          </Section>
          {children}
          <Hr style={hr} />
          <Text style={footer}>
            © {new Date().getFullYear()} {DEFAULT_SITE_NAME}. All rights
            reserved.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: '#f6f6f6',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '24px 0',
};

const container = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '480px',
  padding: '32px',
};

const brand = {
  color: '#171717',
  fontSize: '18px',
  fontWeight: 700 as const,
  margin: '0 0 16px',
};

const hr = {
  borderColor: '#e5e5e5',
  margin: '24px 0 12px',
};

const footer = {
  color: '#8a8a8a',
  fontSize: '12px',
  margin: 0,
};
