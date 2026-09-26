import type { ImageSourcePropType } from 'react-native';

export type CutlistSystem = {
  id: 'telescopic' | 'synchronized' | 'folding';
  name: string;
  subtitle: string;
  /** Systems without a photo render the drawn folding illustration. */
  photo?: ImageSourcePropType;
};

export const cutlistSystems: CutlistSystem[] = [
  {
    id: 'telescopic',
    name: 'Telescopic Sliding',
    subtitle: 'Multi-panel travel system',
    photo: require('../../assets/images/telescopic-sliding-photo.webp'),
  },
  {
    id: 'synchronized',
    name: 'Synchronized System',
    subtitle: 'Balanced panel movement',
    photo: require('../../assets/images/synchronized-system-photo.webp'),
  },
  {
    id: 'folding',
    name: 'Sliding Folding System',
    subtitle: 'Compact folding panels',
    photo: require('../../assets/images/sliding-folding-photo.webp'),
  },
];

export type TelescopicConfiguration = { name: string; image: ImageSourcePropType };

// Tiles were cut from the prototype's telescopic-sliding-cover.png sprite sheet, in the same order.
export const telescopicConfigurations: TelescopicConfiguration[] = [
  { name: '1+0 Sliding System', image: require('../../assets/images/telescopic/tile-01.jpg') },
  { name: '1+1 Sliding System', image: require('../../assets/images/telescopic/tile-02.jpg') },
  { name: '2+0 Sliding System', image: require('../../assets/images/telescopic/tile-03.jpg') },
  { name: '2+1 Sliding System', image: require('../../assets/images/telescopic/tile-04.jpg') },
  { name: '3+0 Sliding System', image: require('../../assets/images/telescopic/tile-05.jpg') },
  { name: '3+1 Sliding System', image: require('../../assets/images/telescopic/tile-06.jpg') },
  { name: '4+0 Sliding System', image: require('../../assets/images/telescopic/tile-07.jpg') },
  { name: '4+1 Sliding System', image: require('../../assets/images/telescopic/tile-08.jpg') },
];

export type SynchronizedConfiguration = { name: string; image: ImageSourcePropType };

// Placeholder photos reused from the telescopic tiles until the real synchronized-system photos are provided.
export const synchronizedConfigurations: SynchronizedConfiguration[] = [
  { name: '2+0 Synchro Sliding System', image: require('../../assets/images/telescopic/tile-01.jpg') },
  { name: '2+2 Synchro Sliding System', image: require('../../assets/images/telescopic/tile-02.jpg') },
  { name: '4+0 Synchro Sliding System', image: require('../../assets/images/telescopic/tile-03.jpg') },
  { name: '4+2 Synchro Sliding System', image: require('../../assets/images/telescopic/tile-04.jpg') },
  { name: '6+0 Synchro Sliding System', image: require('../../assets/images/telescopic/tile-05.jpg') },
  { name: '6+2 Synchro Sliding System', image: require('../../assets/images/telescopic/tile-06.jpg') },
];
