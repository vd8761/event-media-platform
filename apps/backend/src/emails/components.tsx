// Shared layout for EventLens emails (pattern from immich:server/src/emails/
// components/). Neutral styling; rebrandable alongside the web theme.
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components';
import * as React from 'react';

const styles = {
  body: {
    backgroundColor: '#f4f4f5',
    fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    margin: 0,
    padding: '24px 0',
  },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    margin: '0 auto',
    maxWidth: 480,
    padding: '32px 40px',
  },
  heading: { color: '#18181b', fontSize: 22, fontWeight: 700 as const, margin: '0 0 16px' },
  text: { color: '#3f3f46', fontSize: 15, lineHeight: '24px', margin: '0 0 12px' },
  button: {
    backgroundColor: '#4250af',
    borderRadius: 8,
    color: '#ffffff',
    display: 'inline-block',
    fontSize: 15,
    fontWeight: 600 as const,
    padding: '12px 28px',
    textDecoration: 'none',
  },
  footer: { color: '#a1a1aa', fontSize: 12, lineHeight: '18px', margin: '24px 0 0' },
};

export interface LayoutProps {
  preview: string;
  heading: string;
  children: React.ReactNode;
  ctaLabel?: string;
  ctaUrl?: string;
  footer: string;
}

export function EmailLayout({ preview, heading, children, ctaLabel, ctaUrl, footer }: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{heading}</Heading>
          {children}
          {ctaLabel && ctaUrl && (
            <Section style={{ margin: '24px 0 8px' }}>
              <Button href={ctaUrl} style={styles.button}>
                {ctaLabel}
              </Button>
            </Section>
          )}
          <Text style={styles.footer}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export const P = ({ children }: { children: React.ReactNode }) => <Text style={styles.text}>{children}</Text>;
