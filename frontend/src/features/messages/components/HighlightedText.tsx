/** 正文摘要：把命中的关键词与验证码数字包进 `<mark>`。 */

import { Box } from '@mui/material';
import { useMemo } from 'react';

import { splitHighlighted } from '../highlight';
import { MARK_SX } from '../styles';

export interface HighlightedTextProps {
  text: string;
  terms: readonly string[];
}

export default function HighlightedText({ text, terms }: HighlightedTextProps) {
  const termKey = terms.join('\u0000');
  // terms 的内容已由 termKey 覆盖，避免每次渲染都重算
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const segments = useMemo(() => splitHighlighted(text, terms), [text, termKey]);

  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <Box key={index} component="mark" sx={MARK_SX}>
            {segment.text}
          </Box>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
