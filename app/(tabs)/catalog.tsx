import * as WebBrowser from 'expo-web-browser';

import { CatalogueCard } from '@/components/CatalogueCard';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { catalogues, type Catalogue } from '@/data/catalogues';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors } from '@/theme';

export default function CatalogScreen() {
  const { showToast } = useAppUI();

  const open = async (catalogue: Catalogue) => {
    if (!catalogue.url) {
      showToast(`The ${catalogue.title} isn’t available yet.`);
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(catalogue.url, { controlsColor: colors.tint, toolbarColor: colors.white });
    } catch {
      showToast('Couldn’t open the catalogue. Check your connection and try again.');
    }
  };

  return (
    <Screen title="Catalog" subtitle={`${catalogues.length} Taiton catalogues`} grouped>
      <InsetGroup header="Price lists" footer="Catalogues open as PDFs in the browser." separatorInset={86}>
        {catalogues.map((catalogue) => (
          <CatalogueCard key={catalogue.number} catalogue={catalogue} onPress={() => open(catalogue)} />
        ))}
      </InsetGroup>
    </Screen>
  );
}
