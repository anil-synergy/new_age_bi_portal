import React, { useContext, useEffect, useState } from 'react';
import { Route } from 'react-router-dom';
import { ClipLoader } from 'react-spinners';
import { AuthConsumer, AuthContext } from '../components/providers/AuthProvider';
import Layout from '../components/layout';
import { MyContextProvider } from '../components/myContext';

const PrivateRoute = ({ component, ...rest }) => {
  const authService = useContext(AuthContext);
  const [user, setUser] = useState(false);
  useEffect(() => {
    async function setAuthenticatedUser() {
      let authenticatedUser = await authService.signinSilent();
      if (!authenticatedUser || localStorage.getItem('access_token') == null) {
        // && changed to || for checking continues loader
        authService.signinRedirect();
        return;
      }
      if (!authenticatedUser) {
        authenticatedUser = {
          access_token: localStorage.getItem('access_token'),
          id_token: localStorage.getItem('id_token')
        };
      }
      setUser(authenticatedUser);
    }
    setAuthenticatedUser();
  }, [authService]);
  const renderFn = (Component) => (props) => {
    return (
      <AuthConsumer>
        {() => {
          const { isAuthenticated } = authService;
          if (!!Component && isAuthenticated()) {
            return (
              <Layout settings={rest.settings}>
                <MyContextProvider>
                  <Component {...props} />
                </MyContextProvider>
              </Layout>
            );
          }
          return (
            <div className="loader">
              <ClipLoader label="Validating credentials" />
            </div>
          );
        }}
      </AuthConsumer>
    );
  };
  return <Route {...rest} render={renderFn(component)} user={user} />;
};
export default PrivateRoute;
