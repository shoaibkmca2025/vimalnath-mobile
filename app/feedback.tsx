import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { sendFeedback, type FeedbackKind } from '@/lib/admin-sync';
import { useAppContent } from '@/lib/content-sync';
import { colors, type } from '@/theme';

const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
const STAR = '#f5a623';

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'feedback', label: 'Feedback' },
  { value: 'problem', label: 'Problem' },
  { value: 'suggestion', label: 'Suggestion' },
];

const MESSAGE: Record<FeedbackKind, { label: string; placeholder: string }> = {
  feedback: { label: 'Anything to add? (optional)', placeholder: 'What you like, or what could be better.' },
  problem: { label: 'What went wrong?', placeholder: 'Which screen, what you tapped, and what happened. An error message helps too.' },
  suggestion: { label: 'Your idea', placeholder: 'What would make the app more useful to you?' },
};

const appVersion = Constants.expoConfig?.version ?? '';
const platform = `${Platform.OS} ${Platform.Version}`;

/** From the menu: rate the app, report a problem or suggest an idea. It reaches the shop's admin under Feedback. */
export default function FeedbackScreen() {
  const { settings } = useAppContent();
  const [rating, setRating] = useState<number | null>(null);
  const [kind, setKind] = useState<FeedbackKind>('feedback');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const text = message.trim();
  const problem = kind === 'problem' && !text ? 'Tell us what went wrong.' : !rating && !text ? 'Tap a star, or write a message.' : null;

  const send = async () => {
    setTried(true);
    setFailure(null);
    if (problem) return;
    setSending(true);
    try {
      await sendFeedback({ rating, kind, message: text, appVersion, platform });
      setSent(true);
    } catch (error) {
      setFailure(error instanceof Error && error.message ? error.message : 'Couldn’t send it. Try again.');
    } finally {
      setSending(false);
    }
  };

  // When the shop can't be reached, the same words can go by WhatsApp to the shop's number.
  const shopPhone = settings.phone.replace(/\D/g, '');
  const whatsapp = () => {
    const words = [`Vimalnath app ${KINDS.find((item) => item.value === kind)!.label.toLowerCase()}`, rating ? `Rating: ${rating} of 5` : '', text, `App ${appVersion} on ${platform}`].filter(Boolean).join('\n');
    const number = shopPhone.length === 10 ? `91${shopPhone}` : shopPhone;
    Linking.openURL(`https://wa.me/${number}?text=${encodeURIComponent(words)}`).catch(() => {});
  };

  const again = () => {
    setRating(null);
    setKind('feedback');
    setMessage('');
    setTried(false);
    setSent(false);
  };

  if (sent)
    return (
      <Screen title="Feedback" back={{ fallback: '/', label: 'Back' }} grouped>
        <View style={styles.thanks} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={64} color={colors.green} />
          <Text style={styles.thanksTitle}>Thank you!</Text>
          <Text style={styles.thanksBody}>
            {kind === 'problem' ? 'The shop has your report and will look into it.' : kind === 'suggestion' ? 'The shop has your idea.' : 'The shop has your feedback.'}
          </Text>
        </View>
        <Button label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Button label="Send Another" variant="gray" onPress={again} style={styles.secondary} />
      </Screen>
    );

  return (
    <Screen title="Feedback" subtitle="Rate the app, report a problem, or suggest an idea. It goes straight to Vimalnath." back={{ fallback: '/', label: 'Back' }} grouped>
      <InsetGroup header="How do you like the app?">
        <View style={styles.ratingRow}>
          <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                key={star}
                onPress={() => setRating(rating === star ? null : star)}
                accessibilityRole="radio"
                accessibilityState={{ checked: rating === star }}
                accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}, ${RATING_WORDS[star]}`}
                hitSlop={4}
                style={({ pressed }) => [styles.star, pressed && styles.starPressed]}
              >
                <Ionicons name={rating !== null && star <= rating ? 'star' : 'star-outline'} size={38} color={rating !== null && star <= rating ? STAR : colors.tertiaryLabel} />
              </Pressable>
            ))}
          </View>
          <Text style={styles.ratingWord}>{rating ? RATING_WORDS[rating] : 'Tap a star'}</Text>
        </View>
      </InsetGroup>

      <Text style={styles.sectionLabel}>What’s it about?</Text>
      <SegmentedControl options={KINDS} value={kind} onChange={setKind} accessibilityLabel="What it’s about" />

      <TextField
        label={MESSAGE[kind].label}
        value={message}
        onChangeText={setMessage}
        placeholder={MESSAGE[kind].placeholder}
        multiline
        maxLength={2000}
        textAlignVertical="top"
        style={styles.message}
        containerStyle={styles.messageField}
        error={tried && problem ? problem : undefined}
      />

      <Text style={styles.note}>
        Sent with your account and the app version ({appVersion} on {Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'the web'}), so the shop knows who it’s from and can trace a problem.
      </Text>

      {failure && (
        <View style={styles.failure} accessibilityLiveRegion="polite">
          <Text style={styles.failureText}>{failure}</Text>
          {shopPhone.length >= 10 && <Button label="Send on WhatsApp Instead" icon="logo-whatsapp" variant="tinted" size="medium" onPress={whatsapp} />}
        </View>
      )}

      <Button label="Send Feedback" icon="paper-plane-outline" onPress={() => void send()} loading={sending} loadingLabel="Sending…" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  ratingRow: { alignItems: 'center', paddingVertical: 18, gap: 8 },
  stars: { flexDirection: 'row', gap: 6 },
  star: { padding: 4 },
  starPressed: { transform: [{ scale: 0.9 }], opacity: 0.7 },
  ratingWord: { ...type.subheadline, color: colors.secondaryLabel },
  sectionLabel: { ...type.footnote, color: colors.secondaryLabel, textTransform: 'uppercase', marginTop: 4, marginBottom: 8, marginLeft: 16 },
  messageField: { marginTop: 20 },
  message: { minHeight: 120 },
  note: { ...type.footnote, color: colors.secondaryLabel, marginTop: 10, marginBottom: 20, marginHorizontal: 4 },
  failure: { gap: 10, marginBottom: 16, padding: 14, borderRadius: 12, backgroundColor: colors.redFill },
  failureText: { ...type.subheadline, color: colors.red },
  thanks: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  thanksTitle: { ...type.title2 },
  thanksBody: { ...type.body, color: colors.secondaryLabel, textAlign: 'center' },
  secondary: { marginTop: 12 },
});
