import React, { Component } from 'react';
import AuthService from '../auth/authService';

export const AuthContext = React.createContext({
  signinRedirectCallback: () => ({}),
  logout: () => ({}),
  signoutRedirectCallback: () => ({}),
  isAuthenticated: () => ({}),
  signinRedirect: () => ({}),
  signinSilent: () => ({}),
  signinSilentCallback: () => ({}),
  createSigninRequest: () => ({}),
  getUser: () => ({})
});

export const AuthConsumer = AuthContext.Consumer;

export class AuthProvider extends Component {
  authService;

  constructor(props) {
    super(props);
    this.authService = new AuthService();
  }

  render() {
    const { children } = this.props;
    return (
      <AuthContext.Provider value={this.authService}>
        {children}
      </AuthContext.Provider>
    );
  }
}
