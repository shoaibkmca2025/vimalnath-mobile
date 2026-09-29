import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

/** Diagonal hatch used for the offcut at the end of each bar. */
export function WasteStripes() {
  // SVG ids end up inside url(#…), so strip the punctuation React puts in useId values.
  const patternId = `waste${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id={patternId} patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
          <Rect x={0} y={0} width={8} height={8} fill="#e5e5ea" />
          <Rect x={0} y={0} width={3} height={8} fill="#aeaeb2" />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}
