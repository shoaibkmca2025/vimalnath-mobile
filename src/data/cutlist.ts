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
  { name: '1+0 Sliding System', image: require('../../assets/images/telescopic/config-01.jpg') },
  { name: '1+1 Sliding System', image: require('../../assets/images/telescopic/config-02.jpg') },
  { name: '2+0 Sliding System', image: require('../../assets/images/telescopic/config-03.jpg') },
  { name: '2+1 Sliding System', image: require('../../assets/images/telescopic/config-04.jpg') },
  { name: '3+0 Sliding System', image: require('../../assets/images/telescopic/config-05.jpg') },
  { name: '3+1 Sliding System', image: require('../../assets/images/telescopic/config-06.jpg') },
  { name: '4+0 Sliding System', image: require('../../assets/images/telescopic/config-07.jpg') },
  { name: '4+1 Sliding System', image: require('../../assets/images/telescopic/config-08.jpg') },
];

export type SynchronizedConfiguration = { name: string; image: ImageSourcePropType };

export const synchronizedConfigurations: SynchronizedConfiguration[] = [
  { name: '2+0 Synchro Sliding System', image: require('../../assets/images/synchronized/config-01.jpg') },
  { name: '2+2 Synchro Sliding System', image: require('../../assets/images/synchronized/config-02.jpg') },
  { name: '4+0 Synchro Sliding System', image: require('../../assets/images/synchronized/config-03.jpg') },
  { name: '4+2 Synchro Sliding System', image: require('../../assets/images/synchronized/config-04.jpg') },
  { name: '6+0 Synchro Sliding System', image: require('../../assets/images/synchronized/config-05.jpg') },
  { name: '6+2 Synchro Sliding System', image: require('../../assets/images/synchronized/config-06.jpg') },
];

export type FoldingConfiguration = { name: string; image: ImageSourcePropType };

// Drawn panel diagrams (2 to 10 doors, matching the Tavic sliding folding kits) until photos are supplied.
export const foldingConfigurations: FoldingConfiguration[] = [
  { name: '2 Door Sliding Folding System', image: require('../../assets/images/folding/config-02.jpg') },
  { name: '3 Door Sliding Folding System', image: require('../../assets/images/folding/config-03.jpg') },
  { name: '4 Door Sliding Folding System', image: require('../../assets/images/folding/config-04.jpg') },
  { name: '5 Door Sliding Folding System', image: require('../../assets/images/folding/config-05.jpg') },
  { name: '6 Door Sliding Folding System', image: require('../../assets/images/folding/config-06.jpg') },
  { name: '7 Door Sliding Folding System', image: require('../../assets/images/folding/config-07.jpg') },
  { name: '8 Door Sliding Folding System', image: require('../../assets/images/folding/config-08.jpg') },
  { name: '9 Door Sliding Folding System', image: require('../../assets/images/folding/config-09.jpg') },
  { name: '10 Door Sliding Folding System', image: require('../../assets/images/folding/config-10.jpg') },
];
