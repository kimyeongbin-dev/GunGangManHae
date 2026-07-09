// 화면 테스트를 위한 임시 가짜(Mock) 객체입니다.
export const supabase = {
  channel: () => ({
    on: () => ({
      subscribe: () => {}
    })
  }),
  removeChannel: () => {},
  from: () => ({
    update: () => ({
      eq: async () => {}
    })
  })
} as any;