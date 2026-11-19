/* eslint-disable */
/* eslint-disable func-names */
/* eslint-disable no-unused-vars */
import { PowerBIEmbed } from 'powerbi-client-react';
import React, { useContext, useEffect, useState } from 'react';
import { models } from 'powerbi-client';
import { ClipLoader } from 'react-spinners';
import axios from '../../utils/axios';
import { myContext } from '../myContext';
import { toast } from 'react-toastify';
import iconDownload from '../../images/icons/download.svg';
const Report = () => {
	const { reportId } = useContext(myContext);
	const { isSuperAdmin } = useContext(myContext);
	const [sampleReportConfig, setReportConfig] = useState({
		type: 'report',
		embedUrl: undefined,
		tokenType: models.TokenType.Embed,
		accessToken: undefined,
		settings: {
			panes: {
				filters: {
					visible: false
				},
				pageNavigation: {
					visible: false
				}
			}
		}
	});
	const [displayMessage, setMessage] = useState('');
	const [loading, setLoading] = useState(true);
	const [isloading, setisLoading] = useState(false)
	const [getReportFilter, setGetReportFilter] = useState([]);
	useEffect(() => {
		sessionStorage.setItem('feedback-reportId', window?.location?.pathname);
	}, []);
	useEffect(() => {
		if (reportId) {
			setLoading(true);
			const fetchMenuData = async () => {
				setMessage(<div className="wait-message">Please Wait Report is getting fetched ...</div>);
				const data = await axios.get(`bi-report-api/v1/report/token/${reportId}/embededd`);
				if (data?.data) {
					setReportConfig({
						...sampleReportConfig,
						embedUrl: data?.data.embeddedUrl,
						accessToken: data?.data.token,
						settings: {
							panes: {
								...sampleReportConfig.settings.panes,
								pageNavigation: {
									visible: data?.data?.enablePagination
								}
							}
						}
					});
					setLoading(false);
				}
			};
			fetchMenuData().catch((error) => {
				if (error) {
					setReportConfig({
						type: 'report',
						embedUrl: undefined,
						tokenType: models.TokenType.Embed,
						accessToken: undefined,
						settings: {
							panes: {
								filters: {
									visible: false
								},
								pageNavigation: {
									visible: false
								}
							}
						}
					});
					setMessage('');
					setLoading(false);
				}
			});
		}

	}, [reportId]);

	const eventHandlersMap = new Map([
		[
			'loaded',
			function () {
				setMessage('');
			}
		],
		[
			'pageChanged',
			function (event) {
				setGetReportFilter(event);
			}
		],
		[
			'dataSelected',
			function (event) {
				setGetReportFilter(event);
			}
		],
		[
			'dataHyperlinkClicked',
			function (event) {
				setGetReportFilter(event);
			}
		],
		[
			'rendered',
			function () {
			}
		],
		[
			'error',
			function (event) {
				if (event) {
					console.error(event.detail);
				}
			}
		]
	]);
	const handleClickDowloadPDF = (async () => {
		setisLoading(true);
		const filterData = getReportFilter && getReportFilter.detail.dataPoints && getReportFilter.detail?.dataPoints.map((data, index) => {
			return data && data.identity.map((val, key) => {
				const filterVal = {
					tableName: val.target.table,
					column: val.target.column,
					selectedValue: val.equals
				};
				return filterVal;
			});
		});
		const payload = {
			filters: filterData && filterData[0],
			exportFileFormat: 1,
			onlyCurrentPage: false,
			pageParameters: [
				{
					pageName: getReportFilter?.detail?.page?.name,
					visualName: getReportFilter?.detail?.visual?.name,
					// bookmark: {
					// 	name: 'ff',
					// 	state: 'fff'
					// }
				}
			]
		};
		axios.post(`/bi-report-api/v1/report/token/report/${reportId}/download`, payload, { responseType: 'blob' })
			.then((res) => {
				if (res.data) {
					setisLoading(false);
					const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
					const reportLink = document.createElement('a');
					reportLink.href = url;
					reportLink.setAttribute('target', '_blank')
					document.body.appendChild(reportLink);
					reportLink.download = 'Report';
					reportLink.click();
					reportLink.remove();
					toast.success('Downloaded Successfully', 'Success');
				}
			}).catch(() => {
				toast.error('Downloaded Fail', 'error');
				setisLoading(false);
			})

	});

	return (
		<>
			{loading
				? (
					<div className="loader">
						<ClipLoader loading color="#333869" />
					</div>
				) : (
					<>
						{
							reportId && sampleReportConfig?.embedUrl ? (
								<>
									{
										isSuperAdmin &&
										<div className="report-print">
											<button id="btn" className='dowload-btn'
												onClick={!isloading ? handleClickDowloadPDF : ""}>
												{
													isloading ?
														<div className='download-box'>
															<div className="custom-spin-loader dowload-pdf-loader">
																<ClipLoader loading color="#4a4a4a" />
															</div>
															<span className='mul'>Downloading</span>
														</div>
														:
														<div className='download-box'><img src={iconDownload} alt="logo" className="dowload-icon" />
															<span className='mul'>Download PDF</span>
														</div>
												}
											</button>
										</div>
									}

									<PowerBIEmbed embedConfig={sampleReportConfig} eventHandlers={eventHandlersMap} cssClassName="report-content" />
									{displayMessage}
								</>
							) : (
								<span className="center-message">No Reports Found</span>
							)
						}
					</>
				)}
		</>
	);
};

export default Report;
