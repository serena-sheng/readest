import { useTranslation } from '@/hooks/useTranslation';
import TickRuler from './TickRuler';

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 4.0; // 0.5x-4x: Web Speech accepts 0.1-10, Edge/buffered time-stretch is linear
export const SPEED_STEP = 0.05;

const SPEED_MARKS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

export const formatRate = (rate: number) => `${parseFloat(rate.toFixed(2))}×`;

const formatSpeedMark = (mark: number) => mark.toFixed(1);

type SpeedRulerProps = {
  rate: number;
  onSelect: (rate: number) => void;
};

// Speed configuration of the tick ruler (lives in the sheet's Speed
// sub-view): 0.5x to 4x in 0.05 steps keeps every legacy preset (0.75,
// 1.25, 1.75) reachable and adds a fast-listen top end.
const SpeedRuler = ({ rate, onSelect }: SpeedRulerProps) => {
  const _ = useTranslation();
  return (
    <TickRuler
      min={SPEED_MIN}
      max={SPEED_MAX}
      step={SPEED_STEP}
      marks={SPEED_MARKS}
      value={rate}
      ariaLabel={_('Speed')}
      formatValue={formatRate}
      formatMark={formatSpeedMark}
      onSelect={onSelect}
    />
  );
};

export default SpeedRuler;
