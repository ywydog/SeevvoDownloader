/** @fileoverview Vue Router configuration with task and preference routes. */
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        {
          path: '',
          redirect: '/software',
        },
        {
          path: '/software',
          name: 'software',
          component: () => import('@/views/SoftwareCenter.vue'),
        },
        {
          path: '/aiwb',
          name: 'aiwb',
          component: () => import('@/views/AiwbProjects.vue'),
        },
        {
          path: '/task/:status?',
          name: 'task',
          component: () => import('@/views/TaskView.vue'),
          props: true,
        },
        {
          path: '/preference',
          name: 'preference',
          component: () => import('@/views/PreferenceView.vue'),
          children: [
            {
              path: 'general',
              alias: '',
              name: 'preference-general',
              component: () => import('@/components/preference/General.vue'),
            },
            {
              path: 'downloads',
              name: 'preference-downloads',
              component: () => import('@/components/preference/Downloads.vue'),
            },
            {
              path: 'network',
              name: 'preference-network',
              component: () => import('@/components/preference/Network.vue'),
            },
            {
              path: 'advanced',
              name: 'preference-advanced',
              component: () => import('@/components/preference/Advanced.vue'),
            },
          ],
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export default router
