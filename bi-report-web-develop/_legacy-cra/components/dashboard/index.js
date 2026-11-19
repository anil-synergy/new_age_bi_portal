import React from 'react';
import { useParams } from 'react-router-dom';
import Report from './report';
import WelcomePage from './welcomePage';

const Dashboard = () => {
  const params = useParams();
  return (
    <div className="report-wrap">
      {params?.reportId ? <Report /> : <WelcomePage />}
    </div>
  );
};

export default Dashboard;
