// components/common/a11y.ts
// 클릭 가능한 div/span 을 키보드로도 쓸 수 있게 만드는 props 헬퍼.
//
// ★ 왜 필요한가: 그리드 셀·편성표 이름·팀 카드가 전부 onClick 만 달린 div/span 이라
//   마우스 없이는 지명 자체가 불가능했다. 시맨틱 <button> 으로 바꾸면 기존 flex/aspect-ratio
//   레이아웃이 흔들리므로, role/tabIndex/키 핸들러만 얹어 동작을 맞춘다.
import type { KeyboardEvent } from 'react';

// Enter·Space 로 onClick 과 같은 동작을 하도록 해 주는 props 묶음.
export function clickable(onClick: () => void, label?: string) {
    return {
        role: 'button',
        tabIndex: 0,
        'aria-label': label,
        onClick,
        onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            }
        },
    } as const;
}
