import React, { useImperativeHandle, useState } from 'react';
import { Modal } from '@material-ui/core';

const ConfirmModal = React.forwardRef((props, ref) => {
  const { title: titleProp, message: messageProp, okText,
    cancelText, onOkay: onOkProp, onCancel } = props;

  const [open, setOpen] = useState(false);
  const [resolve, setResolve] = useState();
  const [reject, setReject] = useState();
  const [title, setTitle] = useState(titleProp);
  const [message, setMessage] = useState(messageProp);

  const onOkay = () => {
    if (onOkProp) onOkProp();
    setOpen(false);
    resolve();
  };

  const cancel = () => {
    if (onCancel) onCancel();
    setOpen(false);
    reject();
  };

  useImperativeHandle(ref, () => ({
    open: (titleText, messageText) => {
      setTitle(titleText);
      setMessage(messageText);
      setOpen(true);
      return new Promise((res, rej) => {
        setResolve(() => res);
        setReject(() => rej);
      });
    }
  }));

  return (
    <Modal open={open}>
      <div className="confirm-prompt">
        <div className="confirm-prompt__text">
          <p className="" id="heading">
            {title || 'Are you sure?'}
          </p>
          <p className="">{message || ''}</p>
          <p className="">{message || ''}</p>
        </div>
        <div className="confirm-prompt__btn-wrap">
          <button type="button" className="btn-primary btn-md" id="confirm-okay" onClick={() => onOkay()}>
            {okText || 'Yes'}
          </button>
          <button type="button" className="btn-secondary btn-md" id="confirm-cancel" onClick={() => cancel()}>
            {cancelText || 'No'}
          </button>
        </div>
      </div>
    </Modal>
  );
});

export default ConfirmModal;
