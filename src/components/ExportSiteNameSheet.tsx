import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { colors, type } from '@/theme';

type Props = {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (siteName: string) => void;
  /** Wording for reuse outside the bar optimizer (defaults are the bar cutting plan's). */
  body?: string;
  placeholder?: string;
  fieldLabel?: string;
  /** Without a name the button stays off. */
  required?: boolean;
  /** What the field starts with, e.g. the last name typed. */
  initial?: string;
  /** The button's words, e.g. "Share" or "Save". */
  actionLabel?: string;
};

export function ExportSiteNameSheet({
  visible,
  busy,
  onClose,
  onSubmit,
  body = 'The site name is printed at the top of the bar cutting plan.',
  placeholder = 'e.g. Sundaram Residence, Block A',
  fieldLabel = 'Site name',
  required = false,
  initial = '',
  actionLabel = 'Create',
}: Props) {
  const [siteName, setSiteName] = useState(initial);

  useEffect(() => {
    if (visible) setSiteName(initial);
  }, [visible, initial]);

  const missing = required && !siteName.trim();
  const submit = () => {
    if (!busy && !missing) onSubmit(siteName.trim());
  };

  return (
    <Sheet visible={visible} title="Create PDF" onClose={onClose} busy={busy} action={{ label: actionLabel, onPress: submit, loading: busy, disabled: missing }}>
      <View style={styles.body}>
        <TextField
          label={fieldLabel}
          value={siteName}
          onChangeText={setSiteName}
          placeholder={placeholder}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
          editable={!busy}
        />
        <Text style={styles.note}>{body}</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  note: { ...type.footnote, marginTop: 8, marginHorizontal: 4, color: colors.secondaryLabel },
});
