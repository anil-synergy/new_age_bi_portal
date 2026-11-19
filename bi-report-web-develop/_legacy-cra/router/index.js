import React from 'react';
import Groups from '../components/admin/groups';
import AdminPage from '../components/admin/managePage';
import ReportsPage from '../components/admin/reportsPage';
import CategoriesPage from '../components/admin/categoriesPage';
// eslint-disable-next-line no-unused-vars

const Dashboard = React.lazy(() => import('../components/dashboard'));
// const AdminPage = React.lazy(() => import('../components/managePage'));
const SilentRenew = React.lazy(() => import('../components/auth/authSilentRenew'));
const Logout = React.lazy(() => import('../components/auth/Logout'));
const LogoutCallback = React.lazy(() => import('../components/auth/LogoutCallback'));
const Callback = React.lazy(() => import('../components/auth/authCallback'));
const LoginHome = React.lazy(() => import('../components/loginHome'));

const unAuthorised = React.lazy(() => import('../components/AuthPages/UnAuthorized'));
const AcessDenied = React.lazy(() => import('../components/AuthPages/AcessDenied'));
const Redirecting = React.lazy(() => import('../components/AuthPages/Redirecting'));

const routes = {
  publicRoutes: [
    { key: 1, path: '/authentication/callback', component: Callback },
    { key: 2, path: '/authentication/silent_callback', component: SilentRenew },
    { key: 3, path: '/logout', component: Logout },
    { key: 4, path: '/logout/callback', component: LogoutCallback },
    { key: 5, path: '/unauthorized', component: unAuthorised },
    { key: 6, path: '/login', component: LoginHome },
    { key: 7, path: '/access-denied', component: AcessDenied },
    { key: 8, path: '/redirecting', component: Redirecting }
  ],
  secureRoutes: [
    { key: 10, path: '/dashboard', component: Dashboard },
    { key: 11, path: '/dashboard/:reportId', component: Dashboard },
    { key: 12, path: '/admin/users', component: AdminPage },
    { key: 13, path: '/admin/reports', component: ReportsPage },
    { key: 14, path: '/admin/groups', component: Groups },
    { key: 15, path: '/admin/categories', component: CategoriesPage }

  ]
};
export default routes;
