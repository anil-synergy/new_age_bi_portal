import React, { useState } from 'react';
import { BrowserRouter as Router, Route, Switch, Redirect } from 'react-router-dom';
import { ClipLoader } from 'react-spinners';
import jwtDecode from 'jwt-decode';
import history from './utils/history';
import PrivateRoute from './utils/privateRoute';
import routeList from './router';
import { useConfig } from './utils/hooks';

const NotFoundPage = React.lazy(() => import('./components/noPageFound'));

const token = localStorage.getItem('access_token');

// app

function App() {
  const config = useConfig();
  const [user] = useState(token ? jwtDecode(token) : {});

  const filterByRoles = (roles) => {
    if (roles?.length) {
      const userRoles = user.role;
      if (Array.isArray(userRoles)) {
        return roles.some((r) => userRoles.indexOf(r) >= 0);
      }
      return roles.includes(userRoles);
    }
    return true;
  };

  return (
    <>
      <Router basename="/" history={history} config={config}>
        <React.Suspense
          fallback={(
            <div className="loader">
              <ClipLoader label="Fetching Your Page" loading color="#333869" />
            </div>
          )}
        >
          <Switch>
            {routeList.secureRoutes
              .filter((route) => filterByRoles(route.roles))
              .map((route) => {
                const { key, path, component, ...rest } = route;
                return (
                  <PrivateRoute
                    exact
                    key={key}
                    path={path}
                    component={component}
                    settings={rest}
                  />
                );
              })}
            <Redirect from="/" to={!token ? '/login' : '/dashboard'} exact />
            {routeList.publicRoutes.map((route) => (
              <Route exact key={route.key} path={route.path} component={route.component} />
            ))}
            <Route component={NotFoundPage} />
          </Switch>
        </React.Suspense>
      </Router>
    </>
  );
}

export default App;
