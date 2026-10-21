import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

// Placeholder home screen. The globe (F-001) replaces this once the Mapbox
// spike is done and a design direction is chosen.
export default function HomeScreen() {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('home.title')}</Text>
      <Text style={styles.subtitle}>{t('home.subtitle')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 16 },
});
