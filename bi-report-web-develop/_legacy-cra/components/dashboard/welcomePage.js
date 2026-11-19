import React, { useContext } from 'react';
import { myContext } from '../myContext';

const WelcomePage = () => {
  const { allPermissionList } = useContext(myContext);

  const getGreetingTime = (currentTime) => {
    if (!currentTime) { return 'Not able to get time'; }

    const splitAfternoon = 12; // 24hr time to split the afternoon
    const splitEvening = 17; // 24hr time to split the evening
    const currentHour = currentTime;

    if (currentHour >= splitAfternoon && currentHour <= splitEvening) {
      // Between 12 PM and 5PM
      return 'Good Afternoon';
    } if (currentHour >= splitEvening) {
      // Between 5PM and Midnight
      return 'Good Evening';
    }
    // Between dawn and noon
    return 'Good Morning';
  };

  return (
    <div className="welcome-page">
      <div className="welcome-page__text">
        <h2 className="f-bold capitalize">
          {getGreetingTime(new Date().getHours())}
          ,
          {' '}
          {allPermissionList?.name}
        </h2>
        <div className="font-sm">Find and share actionable insights to make data driven decisions</div>
      </div>
      <div className="font-sm">
        For any query, please contact BI Support Team
        <a
          href="mailto:bisupport@synergyship.com"
          className="support-link"
        >
          bisupport@synergyship.com
        </a>
      </div>

    </div>
  );
};

export default WelcomePage;
