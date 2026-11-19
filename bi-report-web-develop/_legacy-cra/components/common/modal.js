import React from 'react';

const Modal = ({ title, children, setshowAddModal, showAddModal, modalshow, buttonTitle }) => {
  // backdropShow = false;
  return (
    <>
      {showAddModal && <div className="backdrop" />}
      <dialog open={showAddModal} className="modal-box">
        <div className="modal-box__container">
          <h3 className="modal-box__title | uppercase f-semi text-center">{title}</h3>
          <div className="modal-box__body">{children}</div>
          {modalshow && (
            <div className="modal-box__btn-wrap">
              <div className="modal-box__btn-group">
                {setshowAddModal && (
                  <button onClick={() => setshowAddModal(false)} type="button" className="btn-secondary btn-md">
                    Cancel
                  </button>
                )}
                {buttonTitle && (
                  <button type="submit" form="myform" className="btn-primary btn-md">
                    {buttonTitle}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
};

export default Modal;
